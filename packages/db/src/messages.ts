import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { and, asc, eq, or } from 'drizzle-orm'
import { db } from './client'
import { allocateConversationSequence, type DbExecutor } from './conversations'
import { createId } from './ids'
import {
  type Attachments,
  attachmentsSchema,
  type VersionedObject,
  versionedObjectSchema,
  waitingStateSchema,
} from './json-schemas'
import * as schema from './schema'

export type MessageAppendInput = {
  conversationId: string
  kind: 'message' | 'tool_call' | 'tool_result' | 'status' | 'system' | 'other'
  role?: 'user' | 'assistant' | 'system' | 'tool'
  direction: 'inbound' | 'outbound' | 'internal'
  bodyText?: string | null
  payload?: VersionedObject
  turnId?: string | null
  replyToEntryId?: string | null
  /** Authoring agent, for rows produced by an agent (e.g. group members). */
  senderAgentId?: string | null
  /** Managed-file references delivered with the row (agent attachments). */
  attachments?: Attachments
}

export function listConversationMessages(conversationId: string) {
  return db
    .select()
    .from(schema.conversationMessages)
    .where(eq(schema.conversationMessages.conversationId, conversationId))
    .orderBy(asc(schema.conversationMessages.sequenceNo))
}

/**
 * Appends one transcript row at the next conversation sequence number.
 * Sequence allocation and the insert share the executor, so passing a
 * transaction handle makes the append part of a larger atomic operation.
 */
export async function appendConversationMessage(
  input: MessageAppendInput,
  executor: DbExecutor = db,
) {
  const sequenceNo = await allocateConversationSequence(input.conversationId, executor)
  const now = Date.now()
  const [message] = await executor
    .insert(schema.conversationMessages)
    .values({
      id: createId('ent'),
      conversationId: input.conversationId,
      turnId: input.turnId ?? null,
      sequenceNo,
      kind: input.kind,
      role: input.role ?? null,
      direction: input.direction,
      bodyText: input.bodyText ?? null,
      ...(input.payload && { payloadJson: versionedObjectSchema.parse(input.payload) }),
      ...(input.attachments && {
        attachmentsJson: attachmentsSchema.parse(input.attachments),
      }),
      senderAgentId: input.senderAgentId ?? null,
      replyToEntryId: input.replyToEntryId ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
  return message
}

export type UserMessageInput = {
  conversationId: string
  text: string
  payload?: VersionedObject
  requestId?: string
  idempotencyKey?: string
  /** Entry this message replies to; silently dropped if it does not exist here. */
  replyToEntryId?: string | null
}

async function findAcceptedMessage(
  requestId: string,
  idempotencyKey: string,
  executor: DbExecutor = db,
) {
  const matches = await executor
    .select()
    .from(schema.turns)
    .where(
      or(
        eq(schema.turns.requestId, requestId),
        eq(schema.turns.idempotencyKey, idempotencyKey),
      ),
    )
    .limit(2)
  const turnIds = new Set(matches.map((turn) => turn.id))
  if (turnIds.size > 1) {
    throw new Error('Request ID and idempotency key resolve to different turns')
  }
  const [turn] = matches
  if (!turn) return undefined

  const [message] = await executor
    .select()
    .from(schema.conversationMessages)
    .where(
      and(
        eq(schema.conversationMessages.conversationId, turn.conversationId),
        eq(schema.conversationMessages.turnId, turn.id),
        eq(schema.conversationMessages.kind, 'message'),
        eq(schema.conversationMessages.role, 'user'),
      ),
    )
    .orderBy(asc(schema.conversationMessages.sequenceNo))
    .limit(1)
  if (!message) throw new Error(`Accepted turn ${turn.id} has no user message`)
  return { message, turn }
}

function isSqliteBusy(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string' &&
    error.code.startsWith('SQLITE_BUSY')
  )
}

async function validateAcceptedMessage(
  accepted: NonNullable<Awaited<ReturnType<typeof findAcceptedMessage>>>,
  input: UserMessageInput,
  executor: DbExecutor = db,
) {
  const payload = versionedObjectSchema.parse(input.payload ?? { version: 1 })
  if (accepted.turn.conversationId !== input.conversationId) {
    throw new Error('An idempotency token cannot be reused in a different conversation')
  }
  if (
    accepted.message.bodyText !== input.text ||
    !isDeepStrictEqual(accepted.message.payloadJson, payload)
  ) {
    throw new Error('An idempotency token cannot be reused with different message input')
  }
  let replyToEntryId: string | null = null
  if (input.replyToEntryId) {
    const [target] = await executor
      .select({ id: schema.conversationMessages.id })
      .from(schema.conversationMessages)
      .where(
        and(
          eq(schema.conversationMessages.conversationId, input.conversationId),
          eq(schema.conversationMessages.id, input.replyToEntryId),
        ),
      )
      .limit(1)
    replyToEntryId = target?.id ?? null
  }
  if (accepted.message.replyToEntryId !== replyToEntryId) {
    throw new Error('An idempotency token cannot be reused with a different reply target')
  }
  return accepted
}

/**
 * The durable composer boundary: one transaction appends the user's
 * transcript row and creates the queued agent turn that will answer it.
 * Either both exist afterwards or neither does.
 */
export async function acceptUserMessage(input: UserMessageInput) {
  const requestId = input.requestId ?? `req_${randomUUID()}`
  const idempotencyKey = input.idempotencyKey ?? `idem_${randomUUID()}`
  let lastError: unknown
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await db.transaction(async (tx) => {
        const existing = await findAcceptedMessage(requestId, idempotencyKey, tx)
        if (existing) return validateAcceptedMessage(existing, input, tx)

        const [conversation] = await tx
          .select()
          .from(schema.conversations)
          .where(eq(schema.conversations.id, input.conversationId))
          .limit(1)
        if (!conversation) {
          throw new Error(`Conversation ${input.conversationId} not found`)
        }
        if (!conversation.ownerAgentId && !conversation.ownerGroupId) {
          throw new Error(`Conversation ${input.conversationId} has no owner`)
        }

        const targetCondition = conversation.ownerAgentId
          ? eq(schema.turns.targetAgentId, conversation.ownerAgentId)
          : eq(schema.turns.conversationId, conversation.id)
        const [waitingTurn] = await tx
          .select()
          .from(schema.turns)
          .where(and(eq(schema.turns.status, 'waiting'), targetCondition))
          .limit(1)
        if (
          waitingTurn?.waitingStateJson &&
          waitingStateSchema.parse(waitingTurn.waitingStateJson).dismissOnMoveOn
        ) {
          const dismissedAt = Date.now()
          await tx
            .update(schema.turns)
            .set({
              status: 'succeeded',
              completedAt: dismissedAt,
              updatedAt: dismissedAt,
            })
            .where(
              and(
                eq(schema.turns.id, waitingTurn.id),
                eq(schema.turns.status, 'waiting'),
              ),
            )
        }

        // Reply targets must live in the same conversation (composite FK); an
        // unknown or foreign target degrades to a plain message instead of
        // failing the send.
        let replyToEntryId: string | null = null
        if (input.replyToEntryId) {
          const [target] = await tx
            .select({ id: schema.conversationMessages.id })
            .from(schema.conversationMessages)
            .where(
              and(
                eq(schema.conversationMessages.conversationId, conversation.id),
                eq(schema.conversationMessages.id, input.replyToEntryId),
              ),
            )
            .limit(1)
          replyToEntryId = target?.id ?? null
        }

        const now = Date.now()
        const [turn] = await tx
          .insert(schema.turns)
          .values({
            id: createId('trn'),
            conversationId: conversation.id,
            // Exactly one of these is set (conversation ownership is XOR): an
            // agent room queues an agent turn, a group room queues one
            // group-targeted turn for the orchestrator.
            targetAgentId: conversation.ownerAgentId,
            targetGroupId: conversation.ownerGroupId,
            lane: 'user',
            source: 'composer',
            status: 'queued',
            requestId,
            idempotencyKey,
            createdAt: now,
            updatedAt: now,
          })
          .returning()

        const message = await appendConversationMessage(
          {
            conversationId: conversation.id,
            kind: 'message',
            role: 'user',
            direction: 'inbound',
            bodyText: input.text,
            payload: input.payload,
            turnId: turn.id,
            replyToEntryId,
          },
          tx,
        )

        return { message, turn }
      })
    } catch (error) {
      lastError = error
      if (isSqliteBusy(error)) {
        await new Promise((resolve) => setTimeout(resolve, 10 * (attempt + 1)))
      }
      // A concurrent transaction may win the unique-key or snapshot race
      // after our initial lookup. Return that durable acceptance rather than
      // surfacing a retry as a failed send.
      try {
        const winner = await findAcceptedMessage(requestId, idempotencyKey)
        if (winner) return validateAcceptedMessage(winner, input)
      } catch (lookupError) {
        if (!isSqliteBusy(lookupError)) throw lookupError
      }
      if (!isSqliteBusy(error)) throw error
    }
  }
  throw lastError
}
