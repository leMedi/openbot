import {
  acceptUserMessage,
  createManagedFile,
  deleteManagedFileIfUnreferenced,
  findUnsettledForegroundTurn,
  findWaitingConversationTurn,
  findAcceptedUserMessage,
  listConversationMessages,
  readManagedFile,
  respondToWaitingTurn,
  SUPERSEDED_TURN_MESSAGE,
  toggleUserReaction,
  waitingStateSchema,
} from '@openbot/db'
import {
  cancelTurnExecution,
  ensureDrainForTurn,
  recoverQueuedTurns,
  type TurnStreamEvent,
  watchTurn,
} from '@openbot/agent'
import * as z from 'zod'
import { badRequest, base } from '../base'
import { fromWatcher } from '../watch'

const sendMessageInput = z.object({
  conversationId: z.string().min(1),
  text: z.string().trim().max(20_000),
  replyToEntryId: z.string().min(1).nullable().default(null),
  attachments: z.array(z.object({
    name: z.string().trim().min(1).max(500),
    mediaType: z.string().trim().min(1).max(200),
    data: z.string().min(1).max(35_000_000).regex(/^[A-Za-z0-9+/]*={0,2}$/),
  })).max(6).default([]),
  requestId: z.string().min(1).max(200),
  idempotencyKey: z.string().min(1).max(200),
}).refine((input) => input.text.length > 0 || input.attachments.length > 0, {
  message: 'A message or attachment is required',
}).refine(
  (input) => input.attachments.reduce((sum, attachment) => sum + attachment.data.length, 0) <=
    35_000_000,
  { message: 'Attachments are too large' },
)

const waitingResponseInput = z.object({
  turnId: z.string().min(1),
  text: z.string().trim().min(1).max(20_000),
  optionId: z.string().min(1).nullable().default(null),
  dismissed: z.boolean().default(false),
  toolCallId: z.string().min(1),
  requestId: z.string().min(1).max(200),
  idempotencyKey: z.string().min(1).max(200),
})

const reactionInput = z.object({
  conversationId: z.string().min(1),
  messageId: z.string().min(1),
  reaction: z.string().trim().min(1).max(64),
})

const turnInput = z.object({ turnId: z.string().min(1) })

export const messages = {
  list: base
    .input(z.object({ conversationId: z.string().min(1) }))
    .handler(async ({ input }) => {
      // Any transcript read is a fine moment to resume interrupted queued work.
      recoverQueuedTurns()
      const [rows, unsettled, waiting] = await Promise.all([
        listConversationMessages(input.conversationId),
        findUnsettledForegroundTurn(input.conversationId),
        findWaitingConversationTurn(input.conversationId),
      ])
      // Waiting interactions take priority so persisted worker approval cards
      // regain their active controls after a reload.
      return { rows, pendingTurnId: waiting?.id ?? unsettled?.id ?? null }
    }),

  send: base.input(sendMessageInput).handler(async ({ input }) => {
    const existing = await findAcceptedUserMessage(input.requestId, input.idempotencyKey)
    if (existing) {
      const resolvedReply = input.replyToEntryId && (
        await listConversationMessages(input.conversationId)
      ).some((message) => message.id === input.replyToEntryId)
        ? input.replyToEntryId
        : null
      const persistedAttachments = await Promise.all(
        existing.message.attachmentsJson.items.map((item) => readManagedFile(item.fileId)),
      )
      const sameAttachments = persistedAttachments.length === input.attachments.length &&
        persistedAttachments.every((stored, index) => {
          const incoming = input.attachments[index]
          return !!stored && !!incoming &&
            stored.file.originalName === incoming.name &&
            stored.file.mediaType === incoming.mediaType &&
            Buffer.from(stored.bytes).equals(Buffer.from(incoming.data, 'base64'))
        })
      if (
        existing.turn.conversationId !== input.conversationId ||
        existing.message.bodyText !== input.text ||
        existing.message.replyToEntryId !== resolvedReply ||
        !sameAttachments
      ) {
        throw badRequest('An idempotency key cannot be reused with different message input')
      }
      ensureDrainForTurn(existing.turn)
      return existing
    }
    // A new user message supersedes the current turn. Cancel it before
    // accepting the replacement so the scheduler cannot start both turns.
    const unsettled = await findUnsettledForegroundTurn(input.conversationId)
    const unansweredQuestion = unsettled?.waitingStateJson
      ? waitingStateSchema.safeParse(unsettled.waitingStateJson)
      : undefined
    const files = []
    let totalBytes = 0
    let accepted: Awaited<ReturnType<typeof acceptUserMessage>>
    try {
      for (const [position, attachment] of input.attachments.entries()) {
        const bytes = Buffer.from(attachment.data, 'base64')
        totalBytes += bytes.byteLength
        if (totalBytes > 25 * 1024 * 1024) throw badRequest('Attachments are too large')
        const extension = (attachment.name.includes('.')
          ? attachment.name.split('.').pop()!
          : 'bin').replace(/[^a-zA-Z0-9]/g, '').slice(0, 20) || 'bin'
        const file = await createManagedFile({
          bytes,
          originalName: attachment.name,
          mediaType: attachment.mediaType,
          subdirectory: 'attachments',
          extension,
        })
        files.push({
          fileId: file.id,
          position,
          metadata: {
            name: attachment.name,
            mediaType: attachment.mediaType,
            byteSize: file.byteSize,
          },
        })
      }
      if (unsettled) {
        await cancelTurnExecution(unsettled.id, {
          preserveSubagents: true,
          message: SUPERSEDED_TURN_MESSAGE,
        })
      }
      accepted = await acceptUserMessage({
        conversationId: input.conversationId,
        text: input.text,
        replyToEntryId: input.replyToEntryId,
        requestId: input.requestId,
        idempotencyKey: input.idempotencyKey,
        attachments: files.length > 0 ? { version: 1, items: files } : undefined,
        prependedMessages: unansweredQuestion?.success
          ? [{
              id: unsettled!.id,
              type: unansweredQuestion.data.dismissOnMoveOn
                ? 'dismissed-question'
                : 'unanswered-question',
              text: unansweredQuestion.data.prompt,
            }]
          : undefined,
      })
    } catch (error) {
      await Promise.all(files.map((file) => deleteManagedFileIfUnreferenced(file.fileId)))
      throw error
    }
    // Execution is deliberately not awaited: the send RPC acknowledges the
    // durable accept, and visible output arrives over the turn stream.
    ensureDrainForTurn(accepted.turn)
    return accepted
  }),

  toggleReaction: base.input(reactionInput).handler(async ({ input }) => {
    const result = await toggleUserReaction(input)
    if (result.wakeTurn) ensureDrainForTurn(result.wakeTurn)
    return result.message
  }),

  respond: base.input(waitingResponseInput).handler(async ({ input }) => {
    const resumed = await respondToWaitingTurn(input)
    ensureDrainForTurn(resumed.turn)
    return resumed
  }),

  cancelTurn: base.input(turnInput).handler(({ input }) => cancelTurnExecution(input.turnId)),

  /**
   * Streams one turn's visible output: one `message` per delivered
   * SendMessage or durable tool-result row, then a terminal `done`, `waiting`
   * interaction, or `error`. Reconnecting replays persisted rows and
   * continues live. Execution does not depend on this connection.
   */
  watchTurn: base.input(turnInput).handler(async function* ({ input, signal }) {
    recoverQueuedTurns()
    yield* fromWatcher<TurnStreamEvent>((onEvent, watchSignal) => watchTurn(input.turnId, onEvent, watchSignal), signal)
  }),
}
