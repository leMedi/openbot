import {
  listConversationSubagents,
  recoverQueuedTurns,
  steerConversationSubagentExecution,
  stopConversationSubagentExecution,
} from '@openbot/agent'
import * as z from 'zod'
import { base } from '../base'

export const subagents = {
  list: base
    .input(z.object({
      conversationId: z.string().min(1),
      includeSettled: z.boolean().default(false),
    }))
    .handler(({ input }) => {
      recoverQueuedTurns()
      return listConversationSubagents(input.conversationId, !input.includeSettled)
    }),

  steer: base
    .input(z.object({
      conversationId: z.string().min(1),
      subagentId: z.string().min(1),
      message: z.string().trim().min(1).max(20_000),
      requestId: z.string().min(1).max(200),
    }))
    .handler(({ input }) => steerConversationSubagentExecution(input)),

  stop: base
    .input(z.object({ conversationId: z.string().min(1), subagentId: z.string().min(1) }))
    .handler(({ input }) => stopConversationSubagentExecution(input.conversationId, input.subagentId)),
}
