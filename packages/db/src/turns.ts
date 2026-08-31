import { randomUUID } from 'node:crypto'
import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { appendCheckpointWithExecutor } from './checkpoints'
import { db } from './client'
import type { DbExecutor } from './conversations'
import { createId } from './ids'
import {
  type CheckpointState,
  type EffectiveTools,
  effectiveToolsSchema,
  type WaitingState,
  waitingStateSchema,
  type VersionedObject,
  versionedObjectSchema,
} from './json-schemas'
import { appendConversationMessage } from './messages'
import * as schema from './schema'

// The documented lane priority: user > agent > background.
const lanePriority = sql`CASE ${schema.turns.lane}
  WHEN 'user' THEN 0
  WHEN 'agent' THEN 1
  ELSE 2 END`

const unsettledPriority = sql`CASE ${schema.turns.status}
  WHEN 'waiting' THEN 0
  WHEN 'running' THEN 0
  ELSE 1 END`

export async function getTurn(id: string) {
  const [turn] = await db
    .select()
    .from(schema.turns)
    .where(eq(schema.turns.id, id))
    .limit(1)
  return turn
}

/** Oldest queued turn for one conversation, or undefined when the queue is empty. */
export async function findNextQueuedTurn(conversationId: string) {
  const [turn] = await db
    .select()
    .from(schema.turns)
    .where(
      and(
        eq(schema.turns.conversationId, conversationId),
        eq(schema.turns.status, 'queued'),
      ),
    )
    .orderBy(asc(lanePriority), asc(schema.turns.createdAt), asc(schema.turns.id))
    .limit(1)
  return turn
}

/**
 * The next queued turn for one target agent across all of its conversations,
 * highest-priority lane first, then oldest. This is the scheduler's pick for
 * "one active turn per target".
 */
export async function findNextQueuedTurnForAgent(agentId: string) {
  const [turn] = await db
    .select()
    .from(schema.turns)
    .where(
      and(
        eq(schema.turns.targetAgentId, agentId),
        eq(schema.turns.status, 'queued'),
        sql`NOT EXISTS (
          SELECT 1 FROM turns AS active
          WHERE active.target_agent_id = ${agentId}
            AND active.status IN ('running', 'waiting')
        )`,
      ),
    )
    .orderBy(asc(lanePriority), asc(schema.turns.createdAt), asc(schema.turns.id))
    .limit(1)
  return turn
}

/**
 * The next queued group-targeted turn for one group's shared room, oldest
 * first. This is the group orchestrator's pick for "one active turn per
 * target".
 */
export async function findNextQueuedTurnForGroup(groupId: string) {
  const [turn] = await db
    .select()
    .from(schema.turns)
    .where(
      and(
        eq(schema.turns.targetGroupId, groupId),
        eq(schema.turns.status, 'queued'),
        sql`NOT EXISTS (
          SELECT 1 FROM turns AS active
          WHERE active.target_group_id = ${groupId}
            AND active.status IN ('running', 'waiting')
        )`,
      ),
    )
    .orderBy(asc(lanePriority), asc(schema.turns.createdAt), asc(schema.turns.id))
    .limit(1)
  return turn
}

/** Child turns queued under one parent turn, in creation order. */
export function findChildTurns(parentTurnId: string) {
  return db
    .select()
    .from(schema.turns)
    .where(eq(schema.turns.parentTurnId, parentTurnId))
    .orderBy(asc(schema.turns.createdAt), asc(schema.turns.id))
}

/** Active turn, or next queued turn, for one conversation. */
export async function findUnsettledTurn(conversationId: string) {
  const [turn] = await db
    .select()
    .from(schema.turns)
    .where(
      and(
        eq(schema.turns.conversationId, conversationId),
        inArray(schema.turns.status, ['queued', 'running', 'waiting']),
      ),
    )
    .orderBy(
      asc(unsettledPriority),
      asc(lanePriority),
      asc(schema.turns.createdAt),
      asc(schema.turns.id),
    )
    .limit(1)
  return turn
}

/** Every queued turn across all conversations, oldest first (startup recovery). */
export function listQueuedTurns() {
  return db
    .select()
    .from(schema.turns)
    .where(eq(schema.turns.status, 'queued'))
    .orderBy(asc(schema.turns.createdAt), asc(schema.turns.id))
}

/**
 * Atomically moves one queued turn to running. The status guard in the WHERE
 * clause means two concurrent claims can never both succeed; the loser gets
 * undefined back.
 */
export async function claimQueuedTurn(id: string) {
  const now = Date.now()
  const [claimed] = await db
    .update(schema.turns)
    .set({
      status: 'running',
      attemptCount: sql`${schema.turns.attemptCount} + 1`,
      startedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(schema.turns.id, id),
        eq(schema.turns.status, 'queued'),
        sql`${schema.turns.id} = (
          SELECT candidate.id FROM turns AS candidate
          WHERE candidate.status = 'queued'
            AND (
              (${schema.turns.targetAgentId} IS NOT NULL
                AND candidate.target_agent_id = ${schema.turns.targetAgentId})
              OR (${schema.turns.targetGroupId} IS NOT NULL
                AND candidate.target_group_id = ${schema.turns.targetGroupId})
            )
          ORDER BY CASE candidate.lane
            WHEN 'user' THEN 0
            WHEN 'agent' THEN 1
            ELSE 2 END,
            candidate.created_at,
            candidate.id
          LIMIT 1
        )`,
        sql`NOT EXISTS (
          SELECT 1 FROM turns AS active
          WHERE active.id <> ${id}
            AND active.status IN ('running', 'waiting')
            AND (
              (${schema.turns.targetAgentId} IS NOT NULL
                AND active.target_agent_id = ${schema.turns.targetAgentId})
              OR (${schema.turns.targetGroupId} IS NOT NULL
                AND active.target_group_id = ${schema.turns.targetGroupId})
            )
        )`,
      ),
    )
    .returning()
  return claimed
}

export type TurnExecutionSnapshot = {
  modelProvider: string
  modelId: string
  effectiveTools: EffectiveTools
  effectivePermissions: VersionedObject
  runtimeContext: VersionedObject
}

/**
 * Records the model, tools, permissions, and runtime context that were
 * actually in effect for this execution. These are historical snapshots, not
 * authorization truth for later turns.
 */
export async function recordTurnExecution(id: string, snapshot: TurnExecutionSnapshot) {
  const [updated] = await db
    .update(schema.turns)
    .set({
      modelProvider: snapshot.modelProvider,
      modelId: snapshot.modelId,
      effectiveToolsJson: effectiveToolsSchema.parse(snapshot.effectiveTools),
      effectivePermissionsJson: versionedObjectSchema.parse(
        snapshot.effectivePermissions,
      ),
      runtimeContextJson: versionedObjectSchema.parse(snapshot.runtimeContext),
      updatedAt: Date.now(),
    })
    .where(eq(schema.turns.id, id))
    .returning()
  return updated
}

export type TurnCompletion = {
  status: 'succeeded' | 'failed' | 'cancelled'
  error?: VersionedObject
}

export async function completeTurn(
  id: string,
  completion: TurnCompletion,
  executor: DbExecutor = db,
) {
  const now = Date.now()
  const [updated] = await executor
    .update(schema.turns)
    .set({
      status: completion.status,
      errorJson: completion.error ?? null,
      completedAt: now,
      updatedAt: now,
    })
    .where(and(eq(schema.turns.id, id), eq(schema.turns.status, 'running')))
    .returning()
  return updated
}

export async function markTurnWaiting(id: string, state: WaitingState) {
  const parsed = waitingStateSchema.parse(state)
  const now = Date.now()
  return db.transaction(async (tx) => {
    const [turn] = await tx
      .update(schema.turns)
      .set({ status: 'waiting', waitingStateJson: parsed, updatedAt: now })
      .where(and(eq(schema.turns.id, id), eq(schema.turns.status, 'running')))
      .returning()
    if (!turn) return undefined
    await appendConversationMessage(
      {
        conversationId: turn.conversationId,
        kind: 'status',
        direction: 'internal',
        bodyText: parsed.prompt,
        payload: {
          version: 1,
          event: 'turn_waiting',
          prompt: parsed.prompt,
          options: parsed.options,
          toolCallId: parsed.originatingToolCall.id,
        },
        turnId: turn.id,
      },
      tx,
    )
    return turn
  })
}

export type WaitingTurnResponseInput = {
  turnId: string
  text: string
  optionId?: string | null
  toolCallId: string
  requestId?: string
  idempotencyKey?: string
}

export async function respondToWaitingTurn(input: WaitingTurnResponseInput) {
  const text = input.text.trim()
  if (!text) throw new Error('A waiting-turn response cannot be empty')
  const requestId = input.requestId ?? `req_${randomUUID()}`
  const idempotencyKey = input.idempotencyKey ?? `idem_${randomUUID()}`
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(schema.turns)
      .where(eq(schema.turns.id, input.turnId))
      .limit(1)
    if (!current) throw new Error(`Turn ${input.turnId} not found`)
    if (!current.waitingStateJson) {
      throw new Error(`Turn ${input.turnId} has no waiting interaction state`)
    }
    const waiting = waitingStateSchema.parse(current.waitingStateJson)
    const optionId = input.optionId ?? null
    const responseRows = await tx
      .select()
      .from(schema.conversationMessages)
      .where(
        and(
          eq(schema.conversationMessages.conversationId, current.conversationId),
          eq(schema.conversationMessages.turnId, current.id),
          eq(schema.conversationMessages.kind, 'message'),
          eq(schema.conversationMessages.role, 'user'),
        ),
      )
      .orderBy(asc(schema.conversationMessages.sequenceNo))
    const requestMatch = responseRows.find(
      (row) =>
        row.payloadJson.event === 'turn_response' &&
        row.payloadJson.requestId === requestId,
    )
    const idempotencyMatch = responseRows.find(
      (row) =>
        row.payloadJson.event === 'turn_response' &&
        row.payloadJson.idempotencyKey === idempotencyKey,
    )
    if (requestMatch && idempotencyMatch && requestMatch.id !== idempotencyMatch.id) {
      throw new Error(
        'Waiting-response request ID and idempotency key resolve to different responses',
      )
    }
    const persistedResponse = requestMatch ?? idempotencyMatch
    if (persistedResponse) {
      if (
        persistedResponse.bodyText !== text ||
        persistedResponse.payloadJson.optionId !== optionId ||
        persistedResponse.payloadJson.toolCallId !== input.toolCallId
      ) {
        throw new Error(
          'A waiting-response idempotency token cannot be reused with different input',
        )
      }
      return { message: persistedResponse, turn: current }
    }
    if (current.status !== 'waiting') {
      throw new Error(`Turn ${input.turnId} is not waiting for input`)
    }
    if (waiting.originatingToolCall.id !== input.toolCallId) {
      throw new Error(`Turn ${input.turnId} is waiting on a different interaction`)
    }
    if (optionId && !waiting.options.some((option) => option.id === optionId)) {
      throw new Error(`Waiting turn ${input.turnId} has no option ${optionId}`)
    }

    const nextState = waitingStateSchema.parse({
      ...waiting,
      response: { optionId, text, requestId, idempotencyKey, respondedAt: Date.now() },
    })
    const now = Date.now()
    const [turn] = await tx
      .update(schema.turns)
      .set({
        status: 'queued',
        waitingStateJson: nextState,
        startedAt: null,
        updatedAt: now,
      })
      .where(and(eq(schema.turns.id, input.turnId), eq(schema.turns.status, 'waiting')))
      .returning()
    if (!turn) throw new Error(`Turn ${input.turnId} is no longer waiting for input`)

    const message = await appendConversationMessage(
      {
        conversationId: turn.conversationId,
        kind: 'message',
        role: 'user',
        direction: 'inbound',
        bodyText: text,
        payload: {
          version: 1,
          event: 'turn_response',
          optionId,
          toolCallId: input.toolCallId,
          requestId,
          idempotencyKey,
        },
        turnId: turn.id,
      },
      tx,
    )
    return { message, turn }
  })
}

export type TurnTerminalInput = {
  turnId: string
  status: 'failed' | 'cancelled'
  message: string
}

export function finalizeTurnTerminal(input: TurnTerminalInput) {
  return db.transaction(async (tx) => {
    const now = Date.now()
    const [turn] = await tx
      .update(schema.turns)
      .set({
        status: input.status,
        errorJson: { version: 1, message: input.message },
        completedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.turns.id, input.turnId),
          inArray(schema.turns.status, ['queued', 'running', 'waiting']),
        ),
      )
      .returning()
    if (!turn) {
      const [existing] = await tx
        .select()
        .from(schema.turns)
        .where(eq(schema.turns.id, input.turnId))
        .limit(1)
      if (!existing) throw new Error(`Turn ${input.turnId} not found`)
      return { turn: existing, message: undefined, changed: false as const }
    }

    const event = input.status === 'failed' ? 'turn_failed' : 'turn_cancelled'
    const label = input.status === 'failed' ? 'failed' : 'cancelled'
    const message = await appendConversationMessage(
      {
        conversationId: turn.conversationId,
        kind: 'status',
        direction: 'internal',
        bodyText: `Turn ${label}: ${input.message}`,
        payload: { version: 1, event, message: input.message },
        turnId: turn.id,
      },
      tx,
    )
    return { turn, message, changed: true as const }
  })
}

export type GroupChildTurnInput = {
  /** The running group-targeted turn being orchestrated. */
  groupTurnId: string
  /** The selected member agent. */
  targetAgentId: string
  orchestrationRound?: number
  positionInRound?: number
}

/**
 * The group orchestrator's delegation boundary: one transaction queues the
 * agent-targeted child turn in the group's shared conversation and settles
 * the parent group turn as succeeded. Either the delegation fully exists
 * afterwards or the group turn stays running for startup recovery to re-queue.
 */
export async function queueGroupChildTurn(input: GroupChildTurnInput) {
  return db.transaction(async (tx) => {
    const [parent] = await tx
      .select()
      .from(schema.turns)
      .where(eq(schema.turns.id, input.groupTurnId))
      .limit(1)
    if (!parent) throw new Error(`Turn ${input.groupTurnId} not found`)
    if (!parent.targetGroupId) {
      throw new Error(`Turn ${input.groupTurnId} is not group-targeted`)
    }
    if (parent.status !== 'running') {
      throw new Error(`Turn ${input.groupTurnId} is not running`)
    }

    const now = Date.now()
    const [childTurn] = await tx
      .insert(schema.turns)
      .values({
        id: createId('trn'),
        conversationId: parent.conversationId,
        targetAgentId: input.targetAgentId,
        parentTurnId: parent.id,
        lane: 'agent',
        source: 'group-orchestrator',
        status: 'queued',
        orchestrationRound: input.orchestrationRound ?? 0,
        positionInRound: input.positionInRound ?? 0,
        createdAt: now,
        updatedAt: now,
      })
      .returning()

    const groupTurn = await completeTurn(parent.id, { status: 'succeeded' }, tx)
    if (!groupTurn) throw new Error(`Turn ${input.groupTurnId} not found`)
    return { childTurn, groupTurn }
  })
}

export type TurnSuccessInput = {
  turnId: string
  conversationId: string
  checkpointState: CheckpointState
}

/**
 * Commits a successful turn's outcome atomically: the next immutable
 * checkpoint (with pointer advance) and the succeeded status. A crash can
 * therefore never persist a succeeded turn without its checkpoint — startup
 * recovery re-queues the still-running turn. User-visible transcript rows are
 * appended in-flight by the SendMessage tool as turn side effects, idempotent
 * on re-execution (keyed by turn + content), so they sit deliberately outside
 * this transaction.
 */
export function finalizeTurnSuccess(input: TurnSuccessInput) {
  return db.transaction(async (tx) => {
    const checkpoint = await appendCheckpointWithExecutor(
      tx,
      input.conversationId,
      input.checkpointState,
    )
    const turn = await completeTurn(input.turnId, { status: 'succeeded' }, tx)
    if (!turn) throw new Error(`Turn ${input.turnId} not found`)
    return { checkpoint, turn }
  })
}
