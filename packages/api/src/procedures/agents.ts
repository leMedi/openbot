import {
  getAgent,
  listAgents,
  updateAgentProfile,
  updateAgentProfileAndMcpAccounts,
} from '@openbot/db'
import {
  canonicalAvailableModelReference,
  createAgent,
  deleteAgent as deleteManagedAgent,
} from '@openbot/agent'
import * as z from 'zod'
import { AVATAR_COLORS, AVATAR_SHAPES } from '@openbot/client/avatar'
import { badRequest, base, notFound } from '../base'

// Creation defaults live in the registry (createAgent); omitted fields here
// stay omitted so partial updates never reset a stored value.
const agentProfileFields = z.object({
  name: z.string().trim().min(1, 'Name is required').max(80),
  description: z.string().trim().max(500),
  avatarShape: z
    .string()
    .refine((v) => AVATAR_SHAPES.some((s) => s.id === v), 'Unknown avatar shape'),
  avatarColor: z
    .string()
    .refine((v) => AVATAR_COLORS.includes(v), 'Unknown avatar color'),
  defaultMode: z.string().trim().min(1).max(40),
  defaultModel: z.string().trim().min(1).max(512).nullable(),
  approvalMode: z.string().trim().min(1).max(40),
  notifyOnUpdates: z.boolean(),
})

const agentCreateInput = agentProfileFields.partial().extend({
  name: agentProfileFields.shape.name,
  mcpAccountIds: z.array(z.string().min(1)).optional(),
})

const agentUpdateInput = z.object({
  id: z.string().min(1),
  patch: agentProfileFields.partial(),
  mcpAccountIds: z.array(z.string().min(1)).optional(),
})

export const agentDeleteInputSchema = z
  .object({ id: z.string().regex(/^agt_[A-Za-z0-9_-]{22}$/, 'Invalid agent id') })
  .strict()

export const agents = {
  list: base.handler(() => listAgents()),

  get: base
    .input(z.object({ id: z.string().min(1) }))
    .handler(async ({ input }) => {
      const agent = await getAgent(input.id)
      if (!agent) throw notFound(`Agent ${input.id} not found`)
      return agent
    }),

  create: base.input(agentCreateInput).handler(async ({ input }) => {
    const { mcpAccountIds, ...profile } = input
    if (profile.defaultModel) {
      const canonical = await canonicalAvailableModelReference(profile.defaultModel)
      if (!canonical) throw badRequest(`Model ${profile.defaultModel} is not available`)
      profile.defaultModel = canonical
    }
    return createAgent(profile, mcpAccountIds)
  }),

  update: base.input(agentUpdateInput).handler(async ({ input }) => {
    if (input.patch.defaultModel) {
      const canonical = await canonicalAvailableModelReference(input.patch.defaultModel)
      if (!canonical) throw badRequest(`Model ${input.patch.defaultModel} is not available`)
      input.patch.defaultModel = canonical
    }
    const updated = input.mcpAccountIds
      ? await updateAgentProfileAndMcpAccounts(input.id, input.patch, input.mcpAccountIds)
      : await updateAgentProfile(input.id, input.patch)
    if (!updated) throw notFound(`Agent ${input.id} not found`)
    return updated
  }),

  remove: base.input(agentDeleteInputSchema).handler(async ({ input }) => {
    const deleted = await deleteManagedAgent(input.id)
    if (!deleted) throw notFound(`Agent ${input.id} not found`)
    return { id: input.id }
  }),
}
