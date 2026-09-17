import {
  createGroup,
  deleteGroup,
  getGroup,
  getGroupConversation,
  listGroups,
  setGroupMembers,
  updateGroupProfile,
} from '@openbot/db'
import * as z from 'zod'
import { base, notFound } from '../base'

// Versioned membership input: the array order is the stored (orchestration)
// order. Only local agents exist in the MVP; the discriminated shape leaves
// room for external member types later.
const groupMemberInput = z.object({
  type: z.literal('agent'),
  agentId: z.string().min(1),
})

const groupProfileFields = z.object({
  name: z.string().trim().min(1, 'Name is required').max(80),
  description: z.string().trim().max(500),
})

const groupCreateInput = groupProfileFields.partial().extend({
  name: groupProfileFields.shape.name,
  members: z.array(groupMemberInput).min(1, 'Add at least one bot'),
})

const groupUpdateInput = z.object({
  id: z.string().min(1),
  patch: groupProfileFields.partial(),
})

const groupMembersInput = z.object({
  id: z.string().min(1),
  members: z.array(groupMemberInput).min(1, 'Keep at least one bot'),
})

const idInput = z.object({ id: z.string().min(1) })

export const groups = {
  list: base.handler(() => listGroups()),

  get: base.input(idInput).handler(async ({ input }) => {
    const group = await getGroup(input.id)
    if (!group) throw notFound(`Group ${input.id} not found`)
    return group
  }),

  create: base.input(groupCreateInput).handler(({ input }) => createGroup(input)),

  update: base.input(groupUpdateInput).handler(async ({ input }) => {
    const updated = await updateGroupProfile(input.id, input.patch)
    if (!updated) throw notFound(`Group ${input.id} not found`)
    return updated
  }),

  setMembers: base
    .input(groupMembersInput)
    .handler(({ input }) => setGroupMembers(input.id, input.members)),

  remove: base.input(idInput).handler(async ({ input }) => {
    // Capture the shared conversation id before the cascade removes it, so
    // the client can drop it from local navigation state.
    const conversation = await getGroupConversation(input.id)
    const deleted = await deleteGroup(input.id)
    if (!deleted) throw notFound(`Group ${input.id} not found`)
    return { id: input.id, conversationId: conversation?.id ?? null }
  }),
}
