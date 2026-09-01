// The AwaitShell tool: checks or waits on a managed shell started with
// runShell, optionally until a regex matches its output.

import { type Agent, type ToolDefinition } from '@openbot/db'
import { RE2JS } from 're2js'
import * as z from 'zod'
import {
  readShellMeta,
  readShellOutput,
  shellExists,
  shellOutputRelativePath,
} from './workspace'

export const awaitShellArgsSchema = z.object({
  shell_id: z.preprocess(
    (value) => (typeof value === 'number' ? String(value) : value),
    z.string().trim().min(1).optional(),
  ),
  block_until_ms: z.number().int().min(0).max(300_000).optional(),
  pattern: z.string().min(1).max(1_000).optional(),
})

export const awaitShellToolDefinition: ToolDefinition = {
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
}

const AWAIT_DEFAULT_BLOCK_MS = 30_000
const AWAIT_POLL_SLICE_MS = 250

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export async function executeAwaitShell(
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
