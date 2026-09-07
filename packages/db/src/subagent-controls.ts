import { createHash } from 'node:crypto'
import { appendConversationMessage, listConversationMessages } from './messages'
import { getTurn } from './turns'
import { subagentControlPayloadSchema } from './json-schemas'

type SubagentControl = ReturnType<typeof subagentControlPayloadSchema.parse>

function digest(parts: string[]) {
  return createHash('sha256').update(parts.join('\0')).digest('base64url').slice(0, 32)
}

function isSqliteConstraint(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  if (
    'code' in error &&
    typeof error.code === 'string' &&
    error.code.startsWith('SQLITE_CONSTRAINT')
  ) return true
  return 'cause' in error && isSqliteConstraint(error.cause)
}

async function appendControlOnce(
  conversationId: string,
  workerId: string,
  bodyText: string,
  control: SubagentControl,
) {
  const id = `ent_${digest([control.controlId, control.stage])}`
  try {
    const message = await appendConversationMessage({
      id,
      conversationId,
      turnId: workerId,
      senderAgentId: null,
      kind: 'status',
      direction: 'internal',
      bodyText,
      payload: control,
    })
    return subagentControlPayloadSchema.parse(message.payloadJson)
  } catch (error) {
    if (!isSqliteConstraint(error)) throw error
    const existing = (await listConversationMessages(conversationId)).find(
      (message) => message.id === id,
    )
    if (!existing) throw error
    return subagentControlPayloadSchema.parse(existing.payloadJson)
  }
}

export async function requestSubagentSteer(input: {
  agentId: string
  conversationId?: string
  requestingTurnId: string
  subagentTurnId: string
  toolCallId: string
  message: string
}) {
  const worker = await getTurn(input.subagentTurnId)
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
  const rows = await listConversationMessages(worker.conversationId)
  const duplicate = rows.find((row) => {
    const parsed = subagentControlPayloadSchema.safeParse(row.payloadJson)
    return parsed.success &&
      parsed.data.stage === 'requested' &&
      parsed.data.controlId === controlId
  })
  if (duplicate) {
    const control = subagentControlPayloadSchema.parse(duplicate.payloadJson)
    if (control.message !== input.message) {
      throw new Error('A subagent steering request cannot be retried with different guidance')
    }
    return {
      status: 'requested' as const,
      control,
      worker,
    }
  }

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
    worker.conversationId,
    worker.id,
    'Subagent steering requested',
    control,
  )
  if (persisted.message !== input.message) {
    throw new Error('A subagent steering request cannot be retried with different guidance')
  }
  return { status: 'requested' as const, control: persisted, worker }
}

export async function listPendingSubagentSteers(subagentTurnId: string) {
  const worker = await getTurn(subagentTurnId)
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
    const worker = await getTurn(control.subagentTurnId)
    if (!worker) continue
    await appendControlOnce(
      worker.conversationId,
      worker.id,
      'Subagent steering applied',
      { ...control, stage: 'applied' },
    )
  }
}
