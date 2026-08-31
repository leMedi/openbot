import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import {
  appendCheckpointWithExecutor,
  getCurrentCheckpointWithExecutor,
} from './checkpoints'
import { db } from './client'
import type { DbExecutor } from './conversations'
import { createId } from './ids'
import {
  type CheckpointState,
  checkpointStateSchema,
  type EffectiveTools,
  effectiveToolsSchema,
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
      and(eq(schema.turns.targetAgentId, agentId), eq(schema.turns.status, 'queued')),
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
      and(eq(schema.turns.targetGroupId, groupId), eq(schema.turns.status, 'queued')),
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

/** Oldest turn in this conversation that has not reached a terminal state. */
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
    .orderBy(asc(schema.turns.createdAt), asc(schema.turns.id))
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
    .where(and(eq(schema.turns.id, id), eq(schema.turns.status, 'queued')))
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
    .where(eq(schema.turns.id, id))
    .returning()
  return updated
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
  assistantText: string
  /** Authoring agent identity recorded on the transcript row (group rooms). */
  senderAgentId?: string | null
  checkpointState: CheckpointState
  /** The executing group member's rendered memory for transactional merging. */
  memoryPrompt?: { agentId: string; prompt: string }
}

/**
 * Commits a successful turn's outcome atomically: the assistant transcript
 * row, the next immutable checkpoint (with pointer advance), and the
 * succeeded status. A crash can therefore never leave a visible assistant
 * message without its checkpoint or a succeeded turn without either —
 * startup recovery re-queues the still-running turn and re-execution starts
 * from a clean slate.
 */
export function finalizeTurnSuccess(input: TurnSuccessInput) {
  return db.transaction(async (tx) => {
    const message = await appendConversationMessage(
      {
        conversationId: input.conversationId,
        kind: 'message',
        role: 'assistant',
        direction: 'outbound',
        bodyText: input.assistantText,
        turnId: input.turnId,
        senderAgentId: input.senderAgentId,
      },
      tx,
    )
    let checkpointState = input.checkpointState
    if (input.memoryPrompt) {
      const current = await getCurrentCheckpointWithExecutor(
        input.conversationId,
        tx,
      )
      const priorMemoryPrompts = current
        ? checkpointStateSchema.parse(current.stateJson).memoryPromptsByAgent ?? {}
        : {}
      checkpointState = {
        ...checkpointState,
        memoryPromptsByAgent: {
          ...priorMemoryPrompts,
          [input.memoryPrompt.agentId]: input.memoryPrompt.prompt,
        },
      }
    }
    const checkpoint = await appendCheckpointWithExecutor(
      tx,
      input.conversationId,
      checkpointState,
    )
    const turn = await completeTurn(input.turnId, { status: 'succeeded' }, tx)
    if (!turn) throw new Error(`Turn ${input.turnId} not found`)
    return { message, checkpoint, turn }
  })
}
