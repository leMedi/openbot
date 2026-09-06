import {
  listConversationMessages,
  toggleAgentReaction,
  type Agent,
  type ToolDefinition,
} from '@openbot/db'
import * as z from 'zod'
import type { ToolTurnContext } from './send-message'

export const REACT_TO_MESSAGE_TOOL_NAME = 'ReactToMessage'

export const reactToMessageArgsSchema = z.object({
  message_id: z.string().trim().min(1),
  emoji: z.string().trim().min(1).max(16),
}).strict()

export const reactToMessageToolDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: REACT_TO_MESSAGE_TOOL_NAME,
    description:
      "React to one of the user's messages with a single emoji tapback, attributed to you. " +
      'Use this very sparingly, only when a reaction is the natural whole response and a reply ' +
      'would be overkill. It is not a substitute for answering a request. Target only a user ' +
      "message's displayed entry ID, never your own sends. Repeating the same reaction toggles " +
      'it off. Mirror the user; if they do not use emoji, basically never use this.',
    parameters: {
      type: 'object',
      properties: {
        message_id: {
          type: 'string',
          minLength: 1,
          description: "Stable entry ID shown on the user message, for example ent_abc123.",
        },
        emoji: {
          type: 'string',
          minLength: 1,
          maxLength: 16,
          description: 'One common emoji, for example 👍, ❤️, 😂, or 🎉.',
        },
      },
      required: ['message_id', 'emoji'],
      additionalProperties: false,
    },
  },
}

export async function executeReactToMessage(
  agent: Agent,
  args: z.infer<typeof reactToMessageArgsSchema>,
  context?: ToolTurnContext,
) {
  if (!context) return { error: 'ReactToMessage is unavailable in this execution context' }
  const target = (await listConversationMessages(context.conversationId)).find(
    (message) =>
      message.id === args.message_id &&
      message.kind === 'message' &&
      message.role === 'user',
  )
  if (!target) {
    return {
      error: `${args.message_id} is not a user message in this conversation`,
    }
  }
  const result = await toggleAgentReaction({
    agentId: agent.id,
    conversationId: context.conversationId,
    messageId: target.id,
    reaction: args.emoji,
  })
  context.onReaction?.(result.message)
  return {
    ok: true,
    applied: result.applied,
    message_id: args.message_id,
    emoji: args.emoji,
  }
}
