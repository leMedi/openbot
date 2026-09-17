import {
  clearConversation,
  deleteConversation,
  listConversations,
  markConversationRead,
  markConversationUnread,
  renameConversationTitle,
} from '@openbot/db'
import * as z from 'zod'
import { base, notFound } from '../base'

const idInput = z.object({ id: z.string().min(1) })

export const conversations = {
  list: base.handler(() => listConversations()),

  rename: base
    .input(z.object({ id: z.string().min(1), title: z.string().trim().min(1).max(200) }))
    .handler(async ({ input }) => {
      const updated = await renameConversationTitle(input.id, input.title)
      if (!updated) throw notFound(`Conversation ${input.id} not found`)
      return updated
    }),

  setUnread: base
    .input(z.object({ id: z.string().min(1), unread: z.boolean() }))
    .handler(async ({ input }) => {
      const updated = input.unread
        ? await markConversationUnread(input.id)
        : await markConversationRead(input.id)
      if (!updated) throw notFound(`Conversation ${input.id} not found`)
      return updated
    }),

  clear: base.input(idInput).handler(({ input }) => clearConversation(input.id)),

  remove: base.input(idInput).handler(async ({ input }) => {
    const deleted = await deleteConversation(input.id)
    if (!deleted) throw notFound(`Conversation ${input.id} not found`)
    return { id: input.id }
  }),
}
