import {
  clearConversation as clearConversationRecord,
  createConversation,
  deleteConversation,
  listConversations,
  markConversationRead,
  markConversationUnread,
  updateConversation,
} from '@openbot/db'
import { createServerFn } from '@tanstack/react-start'
import * as z from 'zod'

const conversationCreateInput = z.object({
  agentId: z.string().min(1),
  title: z.string().trim().min(1).max(200).nullable().default(null),
  origin: z.string().trim().min(1).max(80).nullable().default(null),
  purpose: z.string().trim().min(1).max(500).nullable().default(null),
})

const conversationIdInput = z.object({ id: z.string().min(1) })

const conversationRenameInput = z.object({
  id: z.string().min(1),
  title: z.string().trim().min(1).max(200),
})

const conversationUnreadInput = z.object({
  id: z.string().min(1),
  unread: z.boolean(),
})

export const getConversations = createServerFn({ method: 'GET' }).handler(() =>
  listConversations(),
)

export const addConversation = createServerFn({ method: 'POST' })
  .validator((input: unknown) => conversationCreateInput.parse(input))
  .handler(({ data }) =>
    createConversation({
      ownerAgentId: data.agentId,
      title: data.title,
      origin: data.origin,
      purpose: data.purpose,
    }),
  )

export const renameConversation = createServerFn({ method: 'POST' })
  .validator((input: unknown) => conversationRenameInput.parse(input))
  .handler(async ({ data }) => {
    const updated = await updateConversation(data.id, { title: data.title })
    if (!updated) throw new Error(`Conversation ${data.id} not found`)
    return updated
  })

export const setConversationUnread = createServerFn({ method: 'POST' })
  .validator((input: unknown) => conversationUnreadInput.parse(input))
  .handler(async ({ data }) => {
    const updated = data.unread
      ? await markConversationUnread(data.id)
      : await markConversationRead(data.id)
    if (!updated) throw new Error(`Conversation ${data.id} not found`)
    return updated
  })

export const clearConversation = createServerFn({ method: 'POST' })
  .validator((input: unknown) => conversationIdInput.parse(input))
  .handler(({ data }) => clearConversationRecord(data.id))

export const removeConversation = createServerFn({ method: 'POST' })
  .validator((input: unknown) => conversationIdInput.parse(input))
  .handler(async ({ data }) => {
    const deleted = await deleteConversation(data.id)
    if (!deleted) throw new Error(`Conversation ${data.id} not found`)
    return { id: data.id }
  })
