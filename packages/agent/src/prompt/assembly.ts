// Model message assembly: turns checkpointed history, the shared group
// transcript, and live profile/memory state into the model-facing input.

import {
  checkpointStateSchema,
  getCurrentCheckpoint,
  listConversationMessages,
  listPromptMemoryForAgent,
  type Agent,
  type Group,
  type ModelMessage,
} from '@openbot/db'
import { renderSystemPrompt } from './system'

export type PrivatePromptInput = {
  agent: Agent
  conversationId: string
  turnId: string
}

/**
 * The private-room system message on its own, re-rendered from live profile
 * and memory state. Used when a suspended turn resumes from stored mid-turn
 * history instead of a full reassembly.
 */
export async function renderPrivateSystemMessage(agent: Agent): Promise<ModelMessage> {
  const memory = await listPromptMemoryForAgent(agent.id)
  return { role: 'system', content: renderSystemPrompt({ agent, memory }) }
}

/**
 * Checkpointed history carries the prior conversation, but the system prompt
 * is re-rendered from live profile and memory state on every turn.
 */
export async function assemblePrivateModelMessages(input: PrivatePromptInput) {
  const [checkpoint, memory] = await Promise.all([
    getCurrentCheckpoint(input.conversationId),
    listPromptMemoryForAgent(input.agent.id),
  ])
  const history: ModelMessage[] = checkpoint
    ? checkpointStateSchema
        .parse(checkpoint.stateJson)
        .modelMessages.filter((message) => message.role !== 'system')
    : []
  const turnUserMessages: ModelMessage[] = (
    await listConversationMessages(input.conversationId)
  )
    .filter(
      (message) =>
        message.turnId === input.turnId &&
        message.kind === 'message' &&
        message.role === 'user',
    )
    .map((message) => ({ role: 'user', content: message.bodyText ?? '' }))
  return [
    {
      role: 'system' as const,
      content: renderSystemPrompt({ agent: input.agent, memory }),
    },
    ...history,
    ...turnUserMessages,
  ]
}

export type GroupPromptInput = {
  agent: Agent
  group: Group
  members: Agent[]
  conversationId: string
}

/**
 * Group history is rebuilt from the shared transcript; the system prompt is
 * re-rendered from live profile and memory state on every turn.
 */
export async function assembleGroupModelMessages(input: GroupPromptInput) {
  const [rows, memory] = await Promise.all([
    listConversationMessages(input.conversationId),
    listPromptMemoryForAgent(input.agent.id),
  ])
  const nameOf = (agentId: string) =>
    input.members.find((member) => member.id === agentId)?.name ?? 'Another agent'
  const history: ModelMessage[] = []
  for (const row of rows) {
    if (row.kind !== 'message' || !row.bodyText) continue
    if (row.role === 'user') {
      history.push({ role: 'user', content: row.bodyText })
    } else if (row.senderAgentId === input.agent.id) {
      history.push({ role: 'assistant', content: row.bodyText })
    } else if (row.senderAgentId) {
      history.push({
        role: 'user',
        content: `[${nameOf(row.senderAgentId)}]: ${row.bodyText}`,
      })
    }
  }
  return [
    {
      role: 'system' as const,
      content: renderSystemPrompt({
        agent: input.agent,
        memory,
        group: input.group,
        members: input.members,
      }),
    },
    ...history,
  ]
}
