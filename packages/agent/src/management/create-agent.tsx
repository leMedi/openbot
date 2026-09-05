import { spawn } from 'node:child_process'
import {
  createAgentInTransaction,
  createId,
  db,
  getNextAgentXDisplayNumber,
  type AgentProfileInput,
} from '@openbot/db'
import { isDesktopEnabled } from '../desktop/mode'

const MAX_STDERR_BYTES = 64 * 1024
const MIN_AGENT_X_DISPLAY_NUMBER = 2

export class StartWindowError extends Error {
  constructor(
    message: string,
    readonly exitCode: number | null,
  ) {
    super(message)
    this.name = 'StartWindowError'
  }
}

function startWindowExecutable() {
  const executable = process.env.OPENBOT_START_WINDOW?.trim()
  if (!executable) {
    throw new Error('Agent creation requires OPENBOT_START_WINDOW to be configured')
  }
  return executable
}

/** Start the agent's dedicated X display using the configured host binary. */
export async function startAgentWindow(
  displayNumber: number,
  ownerId: string,
  executable?: string,
) {
  if (!isDesktopEnabled()) return
  const command = executable ?? startWindowExecutable()
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, [String(displayNumber), ownerId], {
      stdio: ['ignore', 'ignore', 'pipe'],
    })
    const stderr: Buffer[] = []
    let stderrBytes = 0
    child.stderr.on('data', (chunk: Buffer) => {
      if (stderrBytes >= MAX_STDERR_BYTES) return
      const remaining = MAX_STDERR_BYTES - stderrBytes
      const captured = chunk.subarray(0, remaining)
      stderr.push(captured)
      stderrBytes += captured.length
    })
    child.once('error', reject)
    child.once('close', (code, signal) => {
      if (code === 0) {
        resolve()
        return
      }
      const detail = Buffer.concat(stderr).toString('utf8').trim()
      reject(
        new StartWindowError(
          detail ||
            (code === 75
              ? `Display :${displayNumber} is unavailable or owned by another agent`
              : `start-window failed ${signal ? `with signal ${signal}` : `with exit code ${code}`}`),
          code,
        ),
      )
    })
  })
}

/** Create all durable agent records and provision its dedicated X display. */
export async function createAgent(
  input: AgentProfileInput,
  mcpAccountIds: string[] = [],
) {
  const agentId = createId('agt')
  const desktopEnabled = isDesktopEnabled()
  return db.transaction(async (transaction) => {
    if (!desktopEnabled) {
      return createAgentInTransaction(transaction, input, mcpAccountIds, {
        id: agentId,
      })
    }
    const xDisplayNumber = Math.max(
      MIN_AGENT_X_DISPLAY_NUMBER,
      await getNextAgentXDisplayNumber(transaction),
    )
    const created = await createAgentInTransaction(transaction, input, mcpAccountIds, {
      id: agentId,
      xDisplayNumber,
    })
    await startAgentWindow(xDisplayNumber, agentId)
    return created
  })
}
