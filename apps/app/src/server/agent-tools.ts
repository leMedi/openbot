import { readFile, stat } from 'node:fs/promises'
import {
  createMemoryItem,
  deleteMemoryItem,
  getMemoryItemForAgent,
  memoryKindSchema,
  searchMemoryForAgent,
  updateMemoryItem,
  type Agent,
  type MemoryItem,
  type ModelToolCall,
} from '@openbot/db'
import { RE2JS } from 're2js'
import * as z from 'zod'
import {
  agentWorkspaceDirectory,
  readShellMeta,
  readShellOutput,
  resolveWorkspacePath,
  shellExists,
  shellOutputRelativePath,
  startBackgroundShell,
  waitForShell,
} from './agent-workspace'
import type { ToolDefinition } from './ai'

const updateMemoryArgsSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('update'),
    id: z.string().min(1).optional(),
    scope: z.enum(['user', 'agent']).optional(),
    kind: memoryKindSchema.optional(),
    content: z.string().trim().min(1).max(20_000).optional(),
  }),
  z.object({
    action: z.literal('forget'),
    id: z.string().min(1),
  }),
])

const recallMemoryArgsSchema = z.object({
  query: z.string().trim().min(1).max(200),
  scope: z.enum(['user', 'agent']).optional(),
  limit: z.number().int().min(1).max(25).optional(),
})

const runShellArgsSchema = z.object({
  command: z.string().trim().min(1).max(20_000),
  cwd: z.string().trim().min(1).max(500).optional(),
  timeoutSeconds: z.number().int().min(1).max(300).optional(),
  background: z.boolean().optional(),
})

const readArgsSchema = z.object({
  path: z.string().trim().min(1).max(1_000),
  offset: z
    .number()
    .int()
    .optional()
    .refine((value) => value === undefined || value !== 0, 'offset must be >= 1 or <= -1'),
  limit: z.number().int().min(1).optional(),
  include_line_numbers: z.boolean().optional(),
})

const awaitShellArgsSchema = z.object({
  shell_id: z.preprocess(
    (value) => (typeof value === 'number' ? String(value) : value),
    z.string().trim().min(1).optional(),
  ),
  block_until_ms: z.number().int().min(0).max(300_000).optional(),
  pattern: z.string().min(1).max(1_000).optional(),
})

export const agentToolDefinitions: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'updateMemory',
      description:
        'Change durable memory. action "update" with an id edits that item; ' +
        'without an id it records a new fact. action "forget" permanently ' +
        'deletes the item with the given id. scope "user" is shared with every ' +
        'assistant this user runs; scope "agent" is private to you (the default ' +
        'for new facts). You can only touch shared-user memory and your own.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['update', 'forget'] },
          id: {
            type: 'string',
            description:
              'Memory item id (mem_...). Required for "forget"; for "update", omit it to record a new fact.',
          },
          scope: {
            type: 'string',
            enum: ['user', 'agent'],
            description:
              'For new facts: "user" = shared across all of this user\'s assistants, "agent" = private to you. Defaults to "agent".',
          },
          kind: {
            type: 'string',
            enum: ['profile', 'log', 'note'],
            description:
              'Tier of the fact: "profile" for lasting facts, "log" for events, "note" for everything else (the default).',
          },
          content: {
            type: 'string',
            description: 'The fact to remember. Required when recording; optional when editing.',
          },
        },
        required: ['action'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'recallMemory',
      description:
        'Search durable memory for facts that are not already in your prompt. ' +
        'Searches shared-user memory plus memory scoped to you; pass scope ' +
        '"user" or "agent" to narrow it. The query matches item content ' +
        'case-insensitively, with "*" as the only wildcard. Results are ' +
        'ordered most recently updated first.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Text to look for; "*" matches any run of characters.' },
          scope: {
            type: 'string',
            enum: ['user', 'agent'],
            description: 'Optional filter: "user" = shared memory only, "agent" = your private memory only.',
          },
          limit: {
            type: 'integer',
            minimum: 1,
            maximum: 25,
            description: 'Maximum items to return (default 10).',
          },
        },
        required: ['query'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'runShell',
      description:
        'Run a non-interactive shell command in your private workspace ' +
        'directory. Files written there persist across turns. Every command ' +
        'becomes a managed shell with a shell_id, its merged stdout+stderr ' +
        'streaming to an output file you can inspect with Read. By default ' +
        'the call blocks up to timeoutSeconds (default 30); a command still ' +
        'running then is NOT killed — you get its output so far and can poll ' +
        'it with AwaitShell or kill its pid. Set background true to return ' +
        'immediately. There is no terminal: commands that prompt for input ' +
        'hang until killed.',
      parameters: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: 'The shell command to run (passed to sh -c).',
          },
          cwd: {
            type: 'string',
            description:
              'Working directory, relative to your workspace root. Defaults to the workspace root.',
          },
          timeoutSeconds: {
            type: 'integer',
            minimum: 1,
            maximum: 300,
            description:
              'Max seconds to block waiting for completion (default 30). The command keeps ' +
              'running if it exceeds this. Ignored for background shells.',
          },
          background: {
            type: 'boolean',
            description:
              'Run the command in the background and return its shell_id immediately (default false).',
          },
        },
        required: ['command'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'Read',
      description:
        'Read a text file in your workspace. Returns the whole file unless ' +
        'offset/limit narrow it to a line range; very long content is ' +
        'truncated with a note to re-read using offset and limit. Use a ' +
        'negative offset to read the last N lines (useful for tailing ' +
        'background shell output files).',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'File path, relative to your workspace root.',
          },
          offset: {
            type: 'integer',
            description:
              '1-based line to start reading from; negative counts from the end of the file. ' +
              'Only provide when the file is too long to read at once.',
          },
          limit: {
            type: 'integer',
            minimum: 1,
            description: 'Number of lines to read.',
          },
          include_line_numbers: {
            type: 'boolean',
            description: 'Prefix each line with its line number (default false).',
          },
        },
        required: ['path'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'AwaitShell',
      description:
        'Check or wait on a background shell started with runShell. Blocks ' +
        'until the shell exits, the regex pattern matches its output, or ' +
        'block_until_ms elapses (default 30000; 0 = non-blocking status ' +
        'check), whichever comes first. Waiting on a regex is useful for ' +
        'known startup/ready/error log lines. Omit shell_id to simply sleep ' +
        'for block_until_ms. When output grows large, Read the output file ' +
        'with a negative offset to see the latest lines.',
      parameters: {
        type: 'object',
        properties: {
          shell_id: {
            type: 'string',
            description:
              'Shell id to poll. If omitted, this tool sleeps for the full block_until_ms. ' +
              'Required when block_until_ms is 0.',
          },
          block_until_ms: {
            type: 'integer',
            minimum: 0,
            maximum: 300_000,
            description:
              'Max time to block before returning, in milliseconds (default 30000). ' +
              '0 returns the current status without waiting.',
          },
          pattern: {
            type: 'string',
            description:
              'Return early once this regex matches the shell output. Matches anywhere in the ' +
              'output so far, with the multiline flag.',
          },
        },
        additionalProperties: false,
      },
    },
  },
]

function selectorFor(item: MemoryItem) {
  return item.scope === 'user'
    ? ({ id: item.id, scope: 'user' } as const)
    : ({
        id: item.id,
        scope: 'agent',
        // The scope CHECK constraint guarantees a subject on agent items.
        subjectAgentId: item.subjectAgentId ?? '',
      } as const)
}

function memoryItemView(item: MemoryItem) {
  return {
    id: item.id,
    scope: item.scope,
    kind: item.kind,
    content: item.content,
    learnedAt: new Date(item.createdAt).toISOString().slice(0, 10),
    via: item.authoredByAgentName,
  }
}

async function executeUpdateMemory(
  agent: Agent,
  args: z.infer<typeof updateMemoryArgsSchema>,
) {
  if (args.action === 'forget') {
    const item = await getMemoryItemForAgent(agent.id, args.id)
    if (!item) return { error: `Memory item ${args.id} was not found in memory you can access` }
    await deleteMemoryItem(selectorFor(item))
    return { forgotten: args.id }
  }
  if (args.id) {
    const item = await getMemoryItemForAgent(agent.id, args.id)
    if (!item) return { error: `Memory item ${args.id} was not found in memory you can access` }
    if (args.content === undefined && args.kind === undefined) {
      return { error: 'An update needs new content or a new kind' }
    }
    const updated = await updateMemoryItem(selectorFor(item), {
      ...(args.content !== undefined && { content: args.content }),
      ...(args.kind !== undefined && { kind: args.kind }),
    })
    return { updated: updated ? memoryItemView(updated) : undefined }
  }
  if (args.content === undefined) {
    return { error: 'Recording a new fact requires content' }
  }
  const scope = args.scope ?? 'agent'
  const created = await createMemoryItem({
    ...(scope === 'user'
      ? { scope: 'user' as const }
      : { scope: 'agent' as const, subjectAgentId: agent.id }),
    kind: args.kind ?? 'note',
    content: args.content,
    authoredByAgentId: agent.id,
    authoredByAgentName: agent.name,
  })
  return { created: memoryItemView(created) }
}

// Inline command output above this keeps its head and tail; the full output
// stays in the shell's output file.
const SHELL_OUTPUT_LIMIT = 8_000
const SHELL_DEFAULT_TIMEOUT_SECONDS = 30

function truncateMiddle(text: string) {
  if (text.length <= SHELL_OUTPUT_LIMIT) return { text, truncated: false }
  const half = SHELL_OUTPUT_LIMIT / 2
  return {
    text: `${text.slice(0, half)}\n…[output truncated]…\n${text.slice(-half)}`,
    truncated: true,
  }
}

async function executeRunShell(
  agent: Agent,
  args: z.infer<typeof runShellArgsSchema>,
) {
  const workspace = agentWorkspaceDirectory(agent.id)
  let cwd = workspace
  if (args.cwd) {
    const resolved = resolveWorkspacePath(workspace, args.cwd)
    if (resolved === null) return { error: 'cwd must stay inside your workspace' }
    cwd = resolved
  }

  // Every command runs as a managed shell: it gets an id and an output file,
  // and foreground mode just waits inline on the same machinery.
  const meta = await startBackgroundShell(agent.id, args.command, cwd)
  const shellView = {
    shell_id: meta.shellId,
    ...(meta.pid !== undefined && { pid: meta.pid }),
    outputPath: shellOutputRelativePath(meta.shellId),
  }
  if (args.background) return { ...shellView, status: 'running' }

  const timeoutMs = (args.timeoutSeconds ?? SHELL_DEFAULT_TIMEOUT_SECONDS) * 1000
  const finished = await waitForShell(agent.id, meta.shellId, timeoutMs)
  const output = truncateMiddle(await readShellOutput(agent.id, meta.shellId))
  if (finished?.endedAt !== undefined) {
    return {
      ...shellView,
      status: 'complete',
      exitCode: finished.exitCode,
      ...(finished.signal && { signal: finished.signal }),
      runtimeMs: finished.endedAt - finished.startedAt,
      output: output.text,
      ...(output.truncated && { outputTruncated: true }),
    }
  }
  return {
    ...shellView,
    status: 'running',
    runtimeMs: timeoutMs,
    output: output.text,
    ...(output.truncated && { outputTruncated: true }),
    note: 'Still running after timeoutSeconds. Poll with AwaitShell, Read the output file, or kill the pid if it is hung.',
  }
}

// A Read response larger than this is truncated and the model is told to
// re-read with offset/limit instead.
const READ_CHAR_LIMIT = 50_000
const READ_FILE_SIZE_LIMIT = 10 * 1024 * 1024

async function executeRead(agent: Agent, args: z.infer<typeof readArgsSchema>) {
  const workspace = agentWorkspaceDirectory(agent.id)
  const resolved = resolveWorkspacePath(workspace, args.path)
  if (resolved === null) return { error: 'path must stay inside your workspace' }

  const info = await stat(resolved).catch(() => null)
  if (!info) return { error: `File not found: ${args.path}` }
  if (info.isDirectory()) return { error: `${args.path} is a directory, not a file` }
  if (info.size > READ_FILE_SIZE_LIMIT) {
    return { error: `File is too large to read (${info.size} bytes)` }
  }

  const raw = await readFile(resolved, 'utf8')
  const lines = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  // A trailing newline produces a phantom empty last line; drop it.
  if (lines.at(-1) === '') lines.pop()
  const totalLines = lines.length

  let startIndex = 0
  let endIndex = totalLines
  if (args.offset !== undefined || args.limit !== undefined) {
    const offset = args.offset ?? 1
    startIndex = offset < 0 ? Math.max(0, totalLines + offset) : Math.max(0, offset - 1)
    if (startIndex >= totalLines && totalLines > 0) {
      return { error: `offset ${offset} is beyond the end of the file (${totalLines} lines)` }
    }
    const limit = args.limit ?? (offset < 0 ? Math.abs(offset) : totalLines)
    endIndex = Math.min(totalLines, startIndex + limit)
  }

  const selected = lines.slice(startIndex, endIndex)
  let content = args.include_line_numbers
    ? selected.map((line, index) => `${startIndex + index + 1}\t${line}`).join('\n')
    : selected.join('\n')
  const truncated = content.length > READ_CHAR_LIMIT
  if (truncated) content = content.slice(0, READ_CHAR_LIMIT)

  return {
    path: args.path,
    totalLines,
    startLine: totalLines === 0 ? 0 : startIndex + 1,
    endLine: endIndex,
    content,
    ...(truncated && {
      truncated: true,
      note: 'Output truncated; re-read with offset and limit to see specific line ranges.',
    }),
  }
}

const AWAIT_DEFAULT_BLOCK_MS = 30_000
const AWAIT_POLL_SLICE_MS = 250

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function executeAwaitShell(
  agent: Agent,
  args: z.infer<typeof awaitShellArgsSchema>,
) {
  const blockUntilMs = args.block_until_ms ?? AWAIT_DEFAULT_BLOCK_MS

  if (!args.shell_id) {
    if (blockUntilMs === 0) return { error: 'Pass a shell_id or a nonzero block_until_ms' }
    await sleep(blockUntilMs)
    return { slept_ms: blockUntilMs }
  }

  const shellId = args.shell_id
  if (!shellExists(agent.id, shellId)) return { error: `No shell found for id ${shellId}` }

  let matcher: InstanceType<typeof RE2JS> | undefined
  if (args.pattern) {
    try {
      matcher = RE2JS.compile(args.pattern, RE2JS.MULTILINE)
    } catch (error) {
      return {
        error: `Invalid pattern: ${error instanceof Error ? error.message : String(error)}`,
      }
    }
  }

  const deadline = Date.now() + blockUntilMs
  while (true) {
    const meta = await readShellMeta(agent.id, shellId)
    if (!meta) return { error: `No shell found for id ${shellId}` }
    const output = await readShellOutput(agent.id, shellId)
    const runtimeMs = (meta.endedAt ?? Date.now()) - meta.startedAt

    let patternMatch: string | undefined
    if (matcher) {
      const found = matcher.matcher(output)
      if (found.find()) patternMatch = (found.group() ?? '').slice(0, 500)
    }

    const done = meta.endedAt !== undefined
    if (done || patternMatch !== undefined || Date.now() >= deadline || blockUntilMs === 0) {
      return {
        shell_id: shellId,
        status: done ? 'complete' : 'running',
        ...(done && { exitCode: meta.exitCode, ...(meta.signal && { signal: meta.signal }) }),
        runtimeMs,
        outputPath: shellOutputRelativePath(shellId),
        outputLength: output.length,
        ...(patternMatch !== undefined && { patternMatch }),
      }
    }
    await sleep(Math.min(AWAIT_POLL_SLICE_MS, deadline - Date.now()))
  }
}

async function executeRecallMemory(
  agent: Agent,
  args: z.infer<typeof recallMemoryArgsSchema>,
) {
  const items = await searchMemoryForAgent(agent.id, args)
  return {
    count: items.length,
    items: items.map(memoryItemView),
  }
}

/**
 * Executes one model-requested tool call and returns the tool-role message
 * content. Bad arguments come back as an error payload the model can correct
 * instead of failing the turn.
 */
export async function executeAgentToolCall(
  agent: Agent,
  call: ModelToolCall,
): Promise<string> {
  const respond = (payload: unknown) => JSON.stringify(payload)
  let args: unknown
  try {
    args = JSON.parse(call.function.arguments || '{}')
  } catch {
    return respond({ error: 'Tool arguments must be valid JSON' })
  }
  try {
    if (call.function.name === 'updateMemory') {
      return respond(await executeUpdateMemory(agent, updateMemoryArgsSchema.parse(args)))
    }
    if (call.function.name === 'recallMemory') {
      return respond(await executeRecallMemory(agent, recallMemoryArgsSchema.parse(args)))
    }
    if (call.function.name === 'runShell') {
      return respond(await executeRunShell(agent, runShellArgsSchema.parse(args)))
    }
    if (call.function.name === 'Read') {
      return respond(await executeRead(agent, readArgsSchema.parse(args)))
    }
    if (call.function.name === 'AwaitShell') {
      return respond(await executeAwaitShell(agent, awaitShellArgsSchema.parse(args)))
    }
    return respond({ error: `Unknown tool: ${call.function.name}` })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return respond({ error: `Invalid arguments: ${z.prettifyError(error)}` })
    }
    return respond({
      error: error instanceof Error ? error.message : 'Tool execution failed',
    })
  }
}
