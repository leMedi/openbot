import {
  getAgent,
  listAgents,
  updateAgentProfile,
  updateAgentProfileAndMcpAccounts,
} from '@openbot/db'
import { createAgent } from '@openbot/agent'
import { createServerFn } from '@tanstack/react-start'
import * as z from 'zod'
import { AVATAR_COLORS, AVATAR_SHAPES } from '@/components/openbot/data'

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
  defaultModel: z.string().trim().min(1).max(120).nullable(),
  approvalMode: z.string().trim().min(1).max(40),
  notifyOnUpdates: z.boolean(),
  hiddenFromSidebar: z.boolean(),
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

export const getAgents = createServerFn({ method: 'GET' }).handler(() =>
  listAgents(),
)

export const getAgentById = createServerFn({ method: 'GET' })
  .validator((input: unknown) => z.object({ id: z.string().min(1) }).parse(input))
  .handler(async ({ data }) => {
    const agent = await getAgent(data.id)
    if (!agent) throw new Error(`Agent ${data.id} not found`)
    return agent
  })

export const addAgent = createServerFn({ method: 'POST' })
  .validator((input: unknown) => agentCreateInput.parse(input))
  .handler(({ data }) => {
    const { mcpAccountIds, ...profile } = data
    return createAgent(profile, mcpAccountIds)
  })

export const updateAgent = createServerFn({ method: 'POST' })
  .validator((input: unknown) => agentUpdateInput.parse(input))
  .handler(async ({ data }) => {
    const updated = data.mcpAccountIds
      ? await updateAgentProfileAndMcpAccounts(
          data.id,
          data.patch,
          data.mcpAccountIds,
        )
      : await updateAgentProfile(data.id, data.patch)
    if (!updated) throw new Error(`Agent ${data.id} not found`)
    return updated
  })
