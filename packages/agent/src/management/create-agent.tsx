import { spawn } from 'node:child_process'
import {
  createAgentInTransaction,
  createId,
  db,
  getNextAgentXDisplayNumber,
  rollbackAgentCreation,
  type AgentProfileInput,
} from '@openbot/db'

const MAX_STDERR_BYTES = 64 * 1024

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
  executable = startWindowExecutable(),
) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, [String(displayNumber), ownerId], {
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
  const created = await db.transaction(async (transaction) => {
    const xDisplayNumber = await getNextAgentXDisplayNumber(transaction)
    return createAgentInTransaction(transaction, input, mcpAccountIds, {
      id: agentId,
      xDisplayNumber,
    })
  })
  try {
    await startAgentWindow(created.agent.xDisplayNumber!, agentId)
    return created
  } catch (error) {
    try {
      await rollbackAgentCreation(agentId)
    } catch (rollbackError) {
      throw new AggregateError(
        [error, rollbackError],
        `Agent ${agentId} display provisioning and database rollback failed`,
      )
    }
    throw error
  }
}
