import {
  createGroup,
  deleteGroup,
  getGroup,
  getGroupConversation,
  listGroups,
  setGroupMembers,
  updateGroupProfile,
} from '@openbot/db'
import { createServerFn } from '@tanstack/react-start'
import * as z from 'zod'

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
  members: z.array(groupMemberInput).default([]),
})

const groupUpdateInput = z.object({
  id: z.string().min(1),
  patch: groupProfileFields.partial(),
})

const groupMembersInput = z.object({
  id: z.string().min(1),
  members: z.array(groupMemberInput),
})

export const getGroups = createServerFn({ method: 'GET' }).handler(() =>
  listGroups(),
)

export const getGroupById = createServerFn({ method: 'GET' })
  .validator((input: unknown) => z.object({ id: z.string().min(1) }).parse(input))
  .handler(async ({ data }) => {
    const group = await getGroup(data.id)
    if (!group) throw new Error(`Group ${data.id} not found`)
    return group
  })

export const addGroup = createServerFn({ method: 'POST' })
  .validator((input: unknown) => groupCreateInput.parse(input))
  .handler(({ data }) => createGroup(data))

export const updateGroup = createServerFn({ method: 'POST' })
  .validator((input: unknown) => groupUpdateInput.parse(input))
  .handler(async ({ data }) => {
    const updated = await updateGroupProfile(data.id, data.patch)
    if (!updated) throw new Error(`Group ${data.id} not found`)
    return updated
  })

export const updateGroupMembers = createServerFn({ method: 'POST' })
  .validator((input: unknown) => groupMembersInput.parse(input))
  .handler(({ data }) => setGroupMembers(data.id, data.members))

export const removeGroup = createServerFn({ method: 'POST' })
  .validator((input: unknown) => z.object({ id: z.string().min(1) }).parse(input))
  .handler(async ({ data }) => {
    // Capture the shared conversation id before the cascade removes it, so
    // the client can drop it from local navigation state.
    const conversation = await getGroupConversation(data.id)
    const deleted = await deleteGroup(data.id)
    if (!deleted) throw new Error(`Group ${data.id} not found`)
    return { id: data.id, conversationId: conversation?.id ?? null }
  })
