import {
  acceptUserMessage,
  findUnsettledTurn,
  listConversationMessages,
} from '@openbot/db'
import { createServerFn } from '@tanstack/react-start'
import * as z from 'zod'
import { ensureAgentDrain, recoverQueuedTurns } from './turn-runner'

const messagesQueryInput = z.object({ conversationId: z.string().min(1) })

const sendMessageInput = z.object({
  conversationId: z.string().min(1),
  text: z.string().trim().min(1).max(20_000),
  replyToEntryId: z.string().min(1).nullable().default(null),
})

export const getConversationMessages = createServerFn({ method: 'GET' })
  .validator((input: unknown) => messagesQueryInput.parse(input))
  .handler(async ({ data }) => {
    // Any transcript read is a fine moment to resume interrupted queued work.
    recoverQueuedTurns()
    const [rows, unsettled] = await Promise.all([
      listConversationMessages(data.conversationId),
      findUnsettledTurn(data.conversationId),
    ])
    // The pending turn lets a reloading client reattach to in-flight output.
    return { rows, pendingTurnId: unsettled?.id ?? null }
  })

export const sendConversationMessage = createServerFn({ method: 'POST' })
  .validator((input: unknown) => sendMessageInput.parse(input))
  .handler(async ({ data }) => {
    const accepted = await acceptUserMessage({
      conversationId: data.conversationId,
      text: data.text,
      replyToEntryId: data.replyToEntryId,
    })
    // Execution is deliberately not awaited: the send RPC acknowledges the
    // durable accept, and visible output arrives over the turn stream.
    if (accepted.turn.targetAgentId) void ensureAgentDrain(accepted.turn.targetAgentId)
    return accepted
  })
