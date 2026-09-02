import {
  listAgents,
  type Agent,
  type ModelToolCall,
  type ToolDefinition,
} from '@openbot/db'
import * as z from 'zod'
import type { ToolTurnContext } from './send-message'

export const SEND_AGENT_MESSAGE_TOOL_NAME = 'SendAgentMessage'

export const sendAgentMessageArgsSchema = z.object({
  recipient: z.string().trim().min(1).max(200),
  content: z.string().trim().min(1).max(20_000),
})

export const sendAgentMessageToolDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: SEND_AGENT_MESSAGE_TOOL_NAME,
    description:
      'Send a durable direct message to another local agent by exact name or agent ID. ' +
      'Delivery queues the recipient asynchronously and returns immediately; it does not ' +
      'wait for their response.',
    parameters: {
      type: 'object',
      properties: {
        recipient: {
          type: 'string',
          description: 'Exact local agent name or agent ID from your system prompt.',
        },
        content: {
          type: 'string',
          description: 'The message for the recipient agent.',
        },
      },
      required: ['recipient', 'content'],
      additionalProperties: false,
    },
  },
}

export async function executeSendAgentMessage(
  sender: Agent,
  args: z.infer<typeof sendAgentMessageArgsSchema>,
  call: ModelToolCall,
  context?: ToolTurnContext,
) {
  if (!context) return { error: 'SendAgentMessage is unavailable in this execution context' }
  const agents = (await listAgents()).filter((agent) => agent.id !== sender.id)
  const byId = agents.find((agent) => agent.id === args.recipient)
  const byName = agents.filter(
    (agent) => agent.name.trim().toLocaleLowerCase() === args.recipient.toLocaleLowerCase(),
  )
  if (!byId && byName.length === 0) {
    return { error: `No other local agent matches ${JSON.stringify(args.recipient)}` }
  }
  if (!byId && byName.length > 1) {
    return {
      error: `Several agents are named ${JSON.stringify(args.recipient)}; use an agent ID`,
      matches: byName.map((agent) => ({ id: agent.id, name: agent.name })),
    }
  }
  const recipient = byId ?? byName[0]
  const delivery = await context.sendDirectAgentMessage({
    recipientAgentId: recipient.id,
    content: args.content,
    idempotencyKey: `direct-agent:${sender.id}:${context.turnId}:${call.id}`,
  })
  return {
    ok: true,
    deliveryId: delivery.deliveryId,
    recipient: { id: recipient.id, name: recipient.name },
    recipientTurnId: delivery.turn.id,
    status: delivery.turn.status,
  }
}
