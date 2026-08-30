import { desc, eq } from 'drizzle-orm'
import { db } from './client'
import { createId } from './ids'
import * as schema from './schema'

export function listConversations() {
  return db
    .select()
    .from(schema.conversations)
    .orderBy(desc(schema.conversations.updatedAt))
}

export async function createConversation(input: {
  ownerAgentId: string
  title?: string | null
}) {
  const now = Date.now()
  const [created] = await db
    .insert(schema.conversations)
    .values({
      id: createId('cnv'),
      ownerAgentId: input.ownerAgentId,
      title: input.title ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
  return created
}

export async function deleteConversation(id: string) {
  const deleted = await db
    .delete(schema.conversations)
    .where(eq(schema.conversations.id, id))
    .returning({ id: schema.conversations.id })
  return deleted.length > 0
}
