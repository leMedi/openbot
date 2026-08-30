import { createAgent, listAgents } from '@openbot/db'
import { createServerFn } from '@tanstack/react-start'
import * as z from 'zod'

const agentInput = z.object({
  name: z.string().trim().min(1, 'Name is required').max(80),
  description: z.string().trim().min(1, 'Description is required').max(500),
})

export const getAgents = createServerFn({ method: 'GET' }).handler(() =>
  listAgents(),
)

export const addAgent = createServerFn({ method: 'POST' })
  .validator((input: unknown) => agentInput.parse(input))
  .handler(({ data }) => createAgent(data))
