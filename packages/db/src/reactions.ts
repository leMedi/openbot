import { and, eq } from 'drizzle-orm'
import { db } from './client'
import { createId } from './ids'
import { reactionsSchema } from './json-schemas'
import * as schema from './schema'

export type ToggleUserReactionInput = {
  conversationId: string
  messageId: string
  reaction: string
}

/** Toggles the local user's reaction and atomically queues an author wake when added. */
export async function toggleUserReaction(input: ToggleUserReactionInput) {
  const reaction = input.reaction.trim()
  if (!reaction || reaction.length > 64) throw new Error('Reaction must be 1-64 characters')

  return db.transaction(async (tx) => {
    const [message] = await tx
      .select()
      .from(schema.conversationMessages)
      .where(
        and(
          eq(schema.conversationMessages.conversationId, input.conversationId),
          eq(schema.conversationMessages.id, input.messageId),
        ),
      )
      .limit(1)
    if (!message || message.kind !== 'message') throw new Error('Message not found')

    const current = reactionsSchema.parse(message.reactionsJson)
    const index = current.items.findIndex(
      (item) =>
        item.reaction === reaction &&
        item.actorAgentId === null &&
        item.actorExternalId === null,
    )
    const applied = index === -1
    const items = [...current.items]
    if (applied) {
      items.push({ reaction, actorAgentId: null, actorExternalId: null, createdAt: Date.now() })
    } else {
      items.splice(index, 1)
    }
    const reactionsJson = reactionsSchema.parse({ version: 1, items })
    const [updated] = await tx
      .update(schema.conversationMessages)
      .set({ reactionsJson, updatedAt: Date.now() })
      .where(eq(schema.conversationMessages.id, message.id))
      .returning()

    let wakeTurn: typeof schema.turns.$inferSelect | undefined
    if (applied && message.role === 'assistant') {
      const [conversation] = await tx
        .select()
        .from(schema.conversations)
        .where(eq(schema.conversations.id, input.conversationId))
        .limit(1)
      const targetAgentId = message.senderAgentId ?? conversation?.ownerAgentId
      if (targetAgentId) {
        const now = Date.now()
        ;[wakeTurn] = await tx
          .insert(schema.turns)
          .values({
            id: createId('trn'),
            conversationId: input.conversationId,
            targetAgentId,
            lane: 'user',
            source: 'user-reaction',
            status: 'queued',
            runtimeContextJson: {
              version: 1,
              wake: {
                version: 1,
                type: 'user-reaction',
                reaction,
                messageId: message.id,
                messageBody: message.bodyText ?? '',
              },
            },
            createdAt: now,
            updatedAt: now,
          })
          .returning()
      }
    }

    return { message: updated, applied, wakeTurn }
  })
}
