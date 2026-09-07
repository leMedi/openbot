import { createHash } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { db } from './client'
import { allocateConversationSequence, type DbExecutor } from './conversations'
import { listConversationMessages } from './messages'
import { subagentControlPayloadSchema } from './json-schemas'
import * as schema from './schema'

type SubagentControl = ReturnType<typeof subagentControlPayloadSchema.parse>

function digest(parts: string[]) {
  return createHash('sha256').update(parts.join('\0')).digest('base64url').slice(0, 32)
}

function isSqliteBusy(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string' &&
    error.code.startsWith('SQLITE_BUSY')
  )
}

async function retryBusy<T>(operation: () => Promise<T>) {
  let lastError: unknown
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      return await operation()
    } catch (error) {
      lastError = error
      if (!isSqliteBusy(error)) throw error
      await new Promise((resolve) => setTimeout(resolve, 10 * (attempt + 1)))
    }
  }
  throw lastError
}

async function appendControlOnce(
  executor: DbExecutor,
  conversationId: string,
  workerId: string,
  bodyText: string,
  control: SubagentControl,
) {
  const id = `ent_${digest([control.controlId, control.stage])}`
  const [existing] = await executor
    .select()
    .from(schema.conversationMessages)
    .where(and(
      eq(schema.conversationMessages.conversationId, conversationId),
      eq(schema.conversationMessages.id, id),
    ))
    .limit(1)
  if (existing) return subagentControlPayloadSchema.parse(existing.payloadJson)

  const sequenceNo = await allocateConversationSequence(conversationId, executor)
  const now = Date.now()
  const [created] = await executor
    .insert(schema.conversationMessages)
    .values({
      id,
      conversationId,
      turnId: workerId,
      kind: 'status',
      direction: 'internal',
      bodyText,
      payloadJson: control,
      sequenceNo,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing()
    .returning()
  if (created) return subagentControlPayloadSchema.parse(created.payloadJson)

  const [winner] = await executor
    .select()
    .from(schema.conversationMessages)
    .where(and(
      eq(schema.conversationMessages.conversationId, conversationId),
      eq(schema.conversationMessages.id, id),
    ))
    .limit(1)
  if (!winner) throw new Error(`Subagent control ${control.controlId} could not be persisted`)
  return subagentControlPayloadSchema.parse(winner.payloadJson)
}

export function requestSubagentSteer(input: {
  agentId: string
  conversationId?: string
  requestingTurnId: string
  subagentTurnId: string
  toolCallId: string
  message: string
}) {
  return retryBusy(() => db.transaction(async (tx) => {
    const [worker] = await tx
      .select()
      .from(schema.turns)
      .where(eq(schema.turns.id, input.subagentTurnId))
      .limit(1)
    if (
      !worker ||
      worker.targetAgentId !== input.agentId ||
      worker.source !== 'subagent' ||
      (input.conversationId && worker.conversationId !== input.conversationId)
    ) {
      return { status: 'not-found' as const }
    }
    if (!['queued', 'running', 'waiting'].includes(worker.status)) {
      return { status: 'not-running' as const, worker }
    }

    const controlId = `ctl_${digest([
      worker.id,
      input.requestingTurnId,
      input.toolCallId,
    ])}`
    const control = subagentControlPayloadSchema.parse({
      version: 1,
      event: 'subagent-control',
      controlId,
      subagentTurnId: worker.id,
      action: 'steer',
      stage: 'requested',
      toolCallId: input.toolCallId,
      message: input.message,
    })
    const persisted = await appendControlOnce(
      tx,
      worker.conversationId,
      worker.id,
      'Subagent steering requested',
      control,
    )
    if (persisted.message !== input.message) {
      throw new Error('A subagent steering request cannot be retried with different guidance')
    }
    return { status: 'requested' as const, control: persisted, worker }
  }))
}

export async function listPendingSubagentSteers(subagentTurnId: string) {
  const [worker] = await db
    .select()
    .from(schema.turns)
    .where(eq(schema.turns.id, subagentTurnId))
    .limit(1)
  if (!worker) return []
  const controls = (await listConversationMessages(worker.conversationId)).flatMap((row) => {
    const parsed = subagentControlPayloadSchema.safeParse(row.payloadJson)
    return parsed.success && parsed.data.subagentTurnId === subagentTurnId ? [parsed.data] : []
  })
  const applied = new Set(
    controls.filter((control) => control.stage === 'applied').map((control) => control.controlId),
  )
  return [...new Map(
    controls
      .filter((control) => control.stage === 'requested' && !applied.has(control.controlId))
      .map((control) => [control.controlId, control]),
  ).values()]
}

export async function markSubagentSteersApplied(
  controls: Awaited<ReturnType<typeof listPendingSubagentSteers>>,
) {
  for (const control of controls) {
    await retryBusy(() => db.transaction(async (tx) => {
      const [worker] = await tx
        .select()
        .from(schema.turns)
        .where(eq(schema.turns.id, control.subagentTurnId))
        .limit(1)
      if (!worker) return
      await appendControlOnce(
        tx,
        worker.conversationId,
        worker.id,
        'Subagent steering applied',
        { ...control, stage: 'applied' },
      )
    }))
  }
}
