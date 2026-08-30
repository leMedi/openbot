import {
  createConversation,
  deleteConversation,
  listConversations,
} from '@openbot/db'
import { createServerFn } from '@tanstack/react-start'
import * as z from 'zod'

const conversationCreateInput = z.object({
  agentId: z.string().min(1),
  title: z.string().trim().min(1).max(200).nullable().default(null),
})

export const getConversations = createServerFn({ method: 'GET' }).handler(() =>
  listConversations(),
)

export const addConversation = createServerFn({ method: 'POST' })
  .validator((input: unknown) => conversationCreateInput.parse(input))
  .handler(({ data }) =>
    createConversation({ ownerAgentId: data.agentId, title: data.title }),
  )

export const removeConversation = createServerFn({ method: 'POST' })
  .validator((input: unknown) => z.object({ id: z.string().min(1) }).parse(input))
  .handler(async ({ data }) => {
    const deleted = await deleteConversation(data.id)
    if (!deleted) throw new Error(`Conversation ${data.id} not found`)
    return { id: data.id }
  })
