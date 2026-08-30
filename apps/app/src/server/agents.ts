import { createAgent, getAgent, listAgents, updateAgentProfile } from '@openbot/db'
import { createServerFn } from '@tanstack/react-start'
import * as z from 'zod'

const agentProfileInput = z.object({
  name: z.string().trim().min(1, 'Name is required').max(80),
  description: z.string().trim().max(500).default(''),
  title: z.string().trim().max(120).default(''),
  defaultModel: z.string().trim().min(1).max(120).nullable().default(null),
  notifyOnUpdates: z.boolean().default(true),
  hiddenFromSidebar: z.boolean().default(false),
})

const agentUpdateInput = z.object({
  id: z.string().min(1),
  patch: agentProfileInput.partial(),
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
  .validator((input: unknown) => agentProfileInput.parse(input))
  .handler(({ data }) => createAgent(data))

export const updateAgent = createServerFn({ method: 'POST' })
  .validator((input: unknown) => agentUpdateInput.parse(input))
  .handler(async ({ data }) => {
    const updated = await updateAgentProfile(data.id, data.patch)
    if (!updated) throw new Error(`Agent ${data.id} not found`)
    return updated
  })
