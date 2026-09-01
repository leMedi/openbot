// The Read tool: reads a text file in the agent workspace, with offset/limit
// line-range narrowing and negative offsets for tailing.

import { readFile, stat } from 'node:fs/promises'
import { type Agent, type ToolDefinition } from '@openbot/db'
import * as z from 'zod'
import { agentWorkspaceDirectory, resolveWorkspacePath } from './shell/workspace'

export const readArgsSchema = z.object({
  path: z.string().trim().min(1).max(1_000),
  offset: z
    .number()
    .int()
    .optional()
    .refine((value) => value === undefined || value !== 0, 'offset must be >= 1 or <= -1'),
  limit: z.number().int().min(1).optional(),
  include_line_numbers: z.boolean().optional(),
})

export const readToolDefinition: ToolDefinition = {
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
}

// A Read response larger than this is truncated and the model is told to
// re-read with offset/limit instead.
const READ_CHAR_LIMIT = 50_000
const READ_FILE_SIZE_LIMIT = 10 * 1024 * 1024

export async function executeRead(agent: Agent, args: z.infer<typeof readArgsSchema>) {
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
