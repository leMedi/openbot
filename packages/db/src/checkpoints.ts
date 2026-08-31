import { createHash } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { db } from './client'
import { createId } from './ids'
import {
  type CheckpointState,
  checkpointStateSchema,
  type VersionedObject,
} from './json-schemas'
import * as schema from './schema'

/**
 * Persists one immutable model-facing snapshot and advances the
 * conversation's current-checkpoint pointer in the same transaction. The new
 * checkpoint's parent is whatever the conversation pointed at before, so
 * lineage follows pointer history. There is deliberately no update API:
 * checkpoints are immutable and all versions are retained until their
 * conversation is deleted.
 */
export async function createConversationCheckpoint(
  conversationId: string,
  state: CheckpointState,
) {
  const validated = checkpointStateSchema.parse(state)
  const serialized = JSON.stringify(validated)

  return db.transaction(async (tx) => {
    const [conversation] = await tx
      .select()
      .from(schema.conversations)
      .where(eq(schema.conversations.id, conversationId))
      .limit(1)
    if (!conversation) throw new Error(`Conversation ${conversationId} not found`)

    const now = Date.now()
    const [checkpoint] = await tx
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

    await tx
      .update(schema.conversations)
      .set({ currentCheckpointId: checkpoint.id, updatedAt: now })
      .where(eq(schema.conversations.id, conversationId))

    return checkpoint
  })
}

/** The checkpoint the conversation currently points at, or undefined. */
export async function getCurrentCheckpoint(conversationId: string) {
  const [conversation] = await db
    .select()
    .from(schema.conversations)
    .where(eq(schema.conversations.id, conversationId))
    .limit(1)
  if (!conversation?.currentCheckpointId) return undefined

  const [checkpoint] = await db
    .select()
    .from(schema.conversationCheckpoints)
    .where(eq(schema.conversationCheckpoints.id, conversation.currentCheckpointId))
    .limit(1)
  return checkpoint
}
