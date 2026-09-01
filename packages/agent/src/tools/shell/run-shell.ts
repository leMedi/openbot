// The runShell tool: runs a non-interactive command in the agent workspace as
// a managed shell (foreground mode waits inline on the same machinery).

import { type Agent, type ToolDefinition } from '@openbot/db'
import * as z from 'zod'
import {
  agentWorkspaceDirectory,
  readShellOutput,
  resolveWorkspacePath,
  shellOutputRelativePath,
  startBackgroundShell,
  waitForShell,
} from './workspace'

export const runShellArgsSchema = z.object({
  command: z.string().trim().min(1).max(20_000),
  cwd: z.string().trim().min(1).max(500).optional(),
  timeoutSeconds: z.number().int().min(1).max(300).optional(),
  background: z.boolean().optional(),
})

export const runShellToolDefinition: ToolDefinition = {
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

export async function executeRunShell(
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
