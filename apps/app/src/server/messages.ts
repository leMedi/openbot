import { acceptUserMessage, listConversationMessages } from '@openbot/db'
import { createServerFn } from '@tanstack/react-start'
import * as z from 'zod'
import { ensureConversationDrain, recoverQueuedTurns } from './turn-runner'

const messagesQueryInput = z.object({ conversationId: z.string().min(1) })

const sendMessageInput = z.object({
  conversationId: z.string().min(1),
  text: z.string().trim().min(1).max(20_000),
})

export const getConversationMessages = createServerFn({ method: 'GET' })
  .validator((input: unknown) => messagesQueryInput.parse(input))
  .handler(({ data }) => {
    // Any transcript read is a fine moment to resume interrupted queued work.
    recoverQueuedTurns()
    return listConversationMessages(data.conversationId)
  })

export const sendConversationMessage = createServerFn({ method: 'POST' })
  .validator((input: unknown) => sendMessageInput.parse(input))
  .handler(async ({ data }) => {
    const accepted = await acceptUserMessage({
      conversationId: data.conversationId,
      text: data.text,
    })
    // Execution is deliberately not awaited: the send RPC acknowledges the
    // durable accept, and visible output arrives over the turn stream.
    void ensureConversationDrain(data.conversationId)
    return accepted
  })
