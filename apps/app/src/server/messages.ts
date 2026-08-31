import {
  acceptUserMessage,
  findUnsettledTurn,
  listConversationMessages,
  respondToWaitingTurn,
} from '@openbot/db'
import { createServerFn } from '@tanstack/react-start'
import * as z from 'zod'
import {
  cancelTurnExecution,
  ensureDrainForTurn,
  recoverQueuedTurns,
} from './turn-runner'

const messagesQueryInput = z.object({ conversationId: z.string().min(1) })

const sendMessageInput = z.object({
  conversationId: z.string().min(1),
  text: z.string().trim().min(1).max(20_000),
  replyToEntryId: z.string().min(1).nullable().default(null),
  requestId: z.string().min(1).max(200),
  idempotencyKey: z.string().min(1).max(200),
})

const waitingResponseInput = z.object({
  turnId: z.string().min(1),
  text: z.string().trim().min(1).max(20_000),
  optionId: z.string().min(1).nullable().default(null),
  toolCallId: z.string().min(1),
  requestId: z.string().min(1).max(200),
  idempotencyKey: z.string().min(1).max(200),
})

const cancelTurnInput = z.object({ turnId: z.string().min(1) })

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
      requestId: data.requestId,
      idempotencyKey: data.idempotencyKey,
    })
    // Execution is deliberately not awaited: the send RPC acknowledges the
    // durable accept, and visible output arrives over the turn stream.
    ensureDrainForTurn(accepted.turn)
    return accepted
  })

export const respondToConversationTurn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => waitingResponseInput.parse(input))
  .handler(async ({ data }) => {
    const resumed = await respondToWaitingTurn(data)
    ensureDrainForTurn(resumed.turn)
    return resumed
  })

export const cancelConversationTurn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => cancelTurnInput.parse(input))
  .handler(async ({ data }) => cancelTurnExecution(data.turnId))
