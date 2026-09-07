import { createServerFn } from '@tanstack/react-start'
import {
  listConversationSubagents,
  recoverQueuedTurns,
  steerConversationSubagentExecution,
  stopConversationSubagentExecution,
} from '@openbot/agent'
import * as z from 'zod'

const listInput = z.object({
  conversationId: z.string().min(1),
  includeSettled: z.boolean().default(false),
})
const steerInput = z.object({
  conversationId: z.string().min(1),
  subagentId: z.string().min(1),
  message: z.string().trim().min(1).max(20_000),
  requestId: z.string().min(1).max(200),
})
const stopInput = z.object({
  conversationId: z.string().min(1),
  subagentId: z.string().min(1),
})

export const getConversationSubagents = createServerFn({ method: 'GET' })
  .validator((input: unknown) => listInput.parse(input))
  .handler(({ data }) => {
    recoverQueuedTurns()
    return listConversationSubagents(data.conversationId, !data.includeSettled)
  })

export const steerAgentSubagent = createServerFn({ method: 'POST' })
  .validator((input: unknown) => steerInput.parse(input))
  .handler(({ data }) => steerConversationSubagentExecution({
    conversationId: data.conversationId,
    subagentId: data.subagentId,
    requestId: data.requestId,
    message: data.message,
  }))

export const stopAgentSubagent = createServerFn({ method: 'POST' })
  .validator((input: unknown) => stopInput.parse(input))
  .handler(({ data }) =>
    stopConversationSubagentExecution(data.conversationId, data.subagentId))
