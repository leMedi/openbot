import { and, asc, eq, sql } from 'drizzle-orm'
import { db } from './client'
import type { EffectiveTools, VersionedObject } from './json-schemas'
import * as schema from './schema'

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
      effectiveToolsJson: snapshot.effectiveTools,
      effectivePermissionsJson: snapshot.effectivePermissions,
      runtimeContextJson: snapshot.runtimeContext,
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

export async function completeTurn(id: string, completion: TurnCompletion) {
  const now = Date.now()
  const [updated] = await db
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
