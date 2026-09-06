import { spawn } from 'node:child_process'
import { readdir, rm } from 'node:fs/promises'
import path from 'node:path'
import {
  dataDirectory,
  deleteAgent as deleteAgentRecords,
  getAgent,
} from '@openbot/db'
import { quiesceAgentExecution } from '../queue/turn-runner'

const MAX_STDERR_BYTES = 64 * 1024
const STOP_WINDOW_TIMEOUT_MS = 70_000
const BROWSER_STATE_DIRECTORY = '/tmp/.browser'

export class StopWindowError extends Error {
  constructor(
    message: string,
    readonly exitCode: number | null,
    readonly signal: NodeJS.Signals | null,
    readonly timedOut = false,
  ) {
    super(message)
    this.name = 'StopWindowError'
  }
}

function stopWindowExecutable() {
  const executable = process.env.OPENBOT_STOP_WINDOW?.trim()
  if (!executable) {
    throw new StopWindowError(
      'Agent deletion requires OPENBOT_STOP_WINDOW to be configured',
      null,
      null,
    )
  }
  return executable
}

/** Stop the agent's dedicated X display using the configured host binary. */
export async function stopAgentWindow(
  displayNumber: number,
  agentId: string,
  executable?: string,
) {
  const command = executable ?? stopWindowExecutable()

  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, [String(displayNumber), agentId], {
      shell: false,
      stdio: ['ignore', 'ignore', 'pipe'],
    })
    const stderr: Buffer[] = []
    let stderrBytes = 0
    let settled = false
    let timer: NodeJS.Timeout | undefined

    const finish = (error?: StopWindowError) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      if (error) reject(error)
      else resolve()
    }
    child.stderr.on('data', (chunk: Buffer) => {
      if (stderrBytes >= MAX_STDERR_BYTES) return
      const captured = chunk.subarray(0, MAX_STDERR_BYTES - stderrBytes)
      stderr.push(captured)
      stderrBytes += captured.length
    })
    child.once('error', (error) => {
      finish(new StopWindowError(
        `Could not run stop-window for agent ${agentId} on display :${String(displayNumber)}: ${error.message}`,
        null,
        null,
      ))
    })
    child.once('close', (code, signal) => {
      if (code === 0) {
        finish()
        return
      }
      const detail = Buffer.concat(stderr).toString('utf8').trim()
      finish(new StopWindowError(
        `Could not stop agent ${agentId} on display :${String(displayNumber)}: ${
          detail || (signal ? `terminated with signal ${signal}` : `exit code ${String(code)}`)
        }`,
        code,
        signal,
      ))
    })
    timer = setTimeout(() => {
      child.kill('SIGKILL')
      finish(new StopWindowError(
        `Timed out after ${String(STOP_WINDOW_TIMEOUT_MS)}ms stopping agent ${agentId} on display :${String(displayNumber)}`,
        null,
        'SIGKILL',
        true,
      ))
    }, STOP_WINDOW_TIMEOUT_MS)
    timer.unref()
  })
}

async function removeBrowserState(displayNumber: number) {
  let names: string[]
  try {
    names = await readdir(BROWSER_STATE_DIRECTORY)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }

  const stateName = `views-${String(displayNumber)}.json`
  await Promise.all(
    names
      .filter((name) =>
        name === stateName ||
        name === `${stateName}.lock` ||
        (name.startsWith(`${stateName}.`) && name.endsWith('.tmp'))
      )
      .map((name) => rm(path.join(BROWSER_STATE_DIRECTORY, name), { force: true })),
  )
}

/** Tear down runtime resources before deleting durable state, then remove per-agent files. */
export async function deleteAgent(id: string) {
  const agent = await getAgent(id)
  if (!agent) return false
  const releaseDeletionGate = await quiesceAgentExecution(agent.id)
  let deleted = false
  try {
    if (agent.xDisplayNumber != null) {
      await stopAgentWindow(agent.xDisplayNumber, agent.id)
    }

    deleted = await deleteAgentRecords(agent.id)
    if (!deleted) return false

    const cleanup = await Promise.allSettled([
      rm(path.join(dataDirectory, 'workspaces', agent.id), { recursive: true, force: true }),
      rm(path.join(dataDirectory, 'chrome-profiles', agent.id), { recursive: true, force: true }),
      ...(agent.xDisplayNumber == null ? [] : [removeBrowserState(agent.xDisplayNumber)]),
    ])
    for (const result of cleanup) {
      if (result.status === 'rejected') {
        console.warn('[agent deletion cleanup failed]', { agentId: agent.id, error: result.reason })
      }
    }
    return true
  } finally {
    await releaseDeletionGate(deleted)
  }
}
