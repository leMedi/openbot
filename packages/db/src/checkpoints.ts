import { createHash } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { db } from './client'
import type { DbExecutor } from './conversations'
import { createId } from './ids'
import {
  type CheckpointState,
  checkpointStateSchema,
  type VersionedObject,
} from './json-schemas'
import * as schema from './schema'

/**
 * Inserts one immutable checkpoint and advances the conversation's
 * current-checkpoint pointer on the given executor. Callers must supply a
 * transaction handle so the insert and the pointer move commit together.
 */
export async function appendCheckpointWithExecutor(
  executor: DbExecutor,
  conversationId: string,
  state: CheckpointState,
) {
  const validated = checkpointStateSchema.parse(state)
  const serialized = JSON.stringify(validated)

  const [conversation] = await executor
    .select()
    .from(schema.conversations)
    .where(eq(schema.conversations.id, conversationId))
    .limit(1)
  if (!conversation) throw new Error(`Conversation ${conversationId} not found`)

  const now = Date.now()
  const [checkpoint] = await executor
    .insert(schema.conversationCheckpoints)
    .values({
      id: createId('chk'),
      conversationId,
      parentCheckpointId: conversation.currentCheckpointId,
      schemaVersion: validated.version,
      stateJson: validated as VersionedObject,
      byteSize: Buffer.byteLength(serialized, 'utf8'),
      contentHash: createHash('sha256').update(serialized).digest('hex'),
      createdAt: now,
    })
    .returning()

  await executor
    .update(schema.conversations)
    .set({ currentCheckpointId: checkpoint.id, updatedAt: now })
    .where(eq(schema.conversations.id, conversationId))

  return checkpoint
}

/**
 * Persists one immutable model-facing snapshot and advances the
 * conversation's current-checkpoint pointer in the same transaction. The new
 * checkpoint's parent is whatever the conversation pointed at before, so
 * lineage follows pointer history. There is deliberately no update API:
 * checkpoints are immutable and all versions are retained until their
 * conversation is deleted.
 */
export function createConversationCheckpoint(
  conversationId: string,
  state: CheckpointState,
) {
  return db.transaction((tx) => appendCheckpointWithExecutor(tx, conversationId, state))
}

/** The checkpoint the conversation currently points at, or undefined. */
export async function getCurrentCheckpoint(conversationId: string) {
  return getCurrentCheckpointWithExecutor(conversationId, db)
}

export async function getCurrentCheckpointWithExecutor(
  conversationId: string,
  executor: DbExecutor,
) {
  const [conversation] = await executor
    .select()
    .from(schema.conversations)
    .where(eq(schema.conversations.id, conversationId))
    .limit(1)
  if (!conversation?.currentCheckpointId) return undefined

  const [checkpoint] = await executor
    .select()
    .from(schema.conversationCheckpoints)
    .where(eq(schema.conversationCheckpoints.id, conversation.currentCheckpointId))
    .limit(1)
  return checkpoint
}
