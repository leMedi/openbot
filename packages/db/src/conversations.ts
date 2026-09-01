import { desc, eq, sql } from 'drizzle-orm'
import { db } from './client'
import { createId } from './ids'
import { deletePiSessionDirectory } from './pi-sessions'
import * as schema from './schema'

export type ConversationCreateInput = {
  ownerAgentId: string
  title?: string | null
  origin?: string | null
  purpose?: string | null
}

// Only navigation-facing fields are patchable; sequence and read-state
// columns move exclusively through their dedicated operations below.
export type ConversationUpdate = Partial<{
  title: string | null
  currentPlanUri: string | null
  origin: string | null
  purpose: string | null
}>

export function listConversations() {
  return db
    .select()
    .from(schema.conversations)
    .orderBy(desc(schema.conversations.updatedAt))
}

export async function getConversation(id: string) {
  const [conversation] = await db
    .select()
    .from(schema.conversations)
    .where(eq(schema.conversations.id, id))
    .limit(1)
  return conversation
}

export async function createConversation(input: ConversationCreateInput) {
  const now = Date.now()
  const [created] = await db
    .insert(schema.conversations)
    .values({
      id: createId('cnv'),
      ownerAgentId: input.ownerAgentId,
      title: input.title ?? null,
      origin: input.origin ?? null,
      purpose: input.purpose ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
  return created
}

export async function updateConversation(id: string, patch: ConversationUpdate) {
  const [updated] = await db
    .update(schema.conversations)
    .set({
      ...(patch.title !== undefined && { title: patch.title }),
      ...(patch.currentPlanUri !== undefined && {
        currentPlanUri: patch.currentPlanUri,
      }),
      ...(patch.origin !== undefined && { origin: patch.origin }),
      ...(patch.purpose !== undefined && { purpose: patch.purpose }),
      updatedAt: Date.now(),
    })
    .where(eq(schema.conversations.id, id))
    .returning()
  return updated
}

/**
 * Read-state changes deliberately leave updatedAt alone so marking a
 * conversation read or unread never reorders the sidebar.
 */
export async function markConversationRead(id: string) {
  const [updated] = await db
    .update(schema.conversations)
    .set({
      lastReadSequenceNo: sql`${schema.conversations.nextSequenceNo} - 1`,
      manuallyUnread: false,
    })
    .where(eq(schema.conversations.id, id))
    .returning()
  return updated
}

export async function markConversationUnread(id: string) {
  const [updated] = await db
    .update(schema.conversations)
    .set({ manuallyUnread: true })
    .where(eq(schema.conversations.id, id))
    .returning()
  return updated
}

/** The database handle or a transaction handle from `db.transaction`. */
export type DbExecutor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0]

/**
 * Atomically advances next_sequence_no and returns the allocated sequence
 * number. A single UPDATE … RETURNING statement means two concurrent
 * allocations can never observe the same value. Pass a transaction handle to
 * allocate as part of a larger atomic operation.
 */
export async function allocateConversationSequence(id: string, executor: DbExecutor = db) {
  const [updated] = await executor
    .update(schema.conversations)
    .set({
      nextSequenceNo: sql`${schema.conversations.nextSequenceNo} + 1`,
      updatedAt: Date.now(),
    })
    .where(eq(schema.conversations.id, id))
    .returning({ nextSequenceNo: schema.conversations.nextSequenceNo })
  if (!updated) throw new Error(`Conversation ${id} not found`)
  return updated.nextSequenceNo - 1
}

/**
 * Deletes the conversation (cascading to its messages and turns) and creates
 * a fresh one for the same owner in one
 * transaction, keeping only identity metadata: title, origin, and purpose.
 *
 * Attachment managed-file references live inside message JSON, so once
 * message attachments are written this must also release files that no
 * remaining record references — SQLite cannot cascade into JSON.
 */
export async function clearConversation(id: string) {
  const now = Date.now()
  const fresh = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(schema.conversations)
      .where(eq(schema.conversations.id, id))
      .limit(1)
    if (!existing) throw new Error(`Conversation ${id} not found`)

    await tx.delete(schema.conversations).where(eq(schema.conversations.id, id))

    const [fresh] = await tx
      .insert(schema.conversations)
      .values({
        id: createId('cnv'),
        ownerAgentId: existing.ownerAgentId,
        ownerGroupId: existing.ownerGroupId,
        title: existing.title,
        origin: existing.origin,
        purpose: existing.purpose,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
    return fresh
  })
  await deletePiSessionDirectory(id)
  return fresh
}

export async function deleteConversation(id: string) {
  const deleted = await db
    .delete(schema.conversations)
    .where(eq(schema.conversations.id, id))
    .returning({ id: schema.conversations.id })
  if (deleted.length === 0) return false
  await deletePiSessionDirectory(id)
  return true
}
