import { enqueueDueRoutineRuns } from '@openbot/db'
import { ensureDrainForTurn, recoverQueuedTurns } from './turn-runner'
import { publishRoutineEvent } from './routine-events'

const POLL_INTERVAL_MS = 30_000
let started = false
let ticking = false

export function activateRoutineTurn(turn: {
  id: string
  routineId: string | null
  conversationId: string
  targetAgentId: string | null
  targetGroupId: string | null
}) {
  if (turn.routineId) {
    publishRoutineEvent({
      type: 'routine',
      phase: 'queued',
      routineId: turn.routineId,
      turnId: turn.id,
      conversationId: turn.conversationId,
    })
  }
  ensureDrainForTurn(turn)
}

async function tick() {
  if (ticking) return
  ticking = true
  try {
    for (const turn of await enqueueDueRoutineRuns()) {
      activateRoutineTurn(turn)
    }
  } catch (error) {
    console.error('Routine scheduler tick failed', error)
  } finally {
    ticking = false
  }
}

/** Starts the one process-local cron authority and startup turn recovery. */
export function startRoutineScheduler() {
  if (started) return
  started = true
  recoverQueuedTurns()
  void tick()
  const timer = setInterval(() => void tick(), POLL_INTERVAL_MS)
  timer.unref()
}

export async function runRoutineSchedulerNow() {
  await tick()
}
