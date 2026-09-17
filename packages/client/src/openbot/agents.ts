// Maps persisted agents (@openbot/db rows, fetched through server functions)
// onto the UI's Bot view model so persisted and mock bots render the same way.

import type { Agent } from '@openbot/db'
import type { Bot } from './data'

export function agentAvatarUrl(agent: Agent) {
  if (!agent.avatarFileId) return undefined
  return `/api/agents/${agent.id}/avatar?v=${encodeURIComponent(agent.avatarFileId)}`
}

export function botFromAgent(agent: Agent, defaultModel: string): Bot {
  return {
    id: agent.id,
    name: agent.name,
    color: agent.avatarColor,
    shape: agent.avatarShape,
    model: agent.defaultModel ?? defaultModel,
    prompt: agent.description,
    grants: [],
    memory: '',
    avatarUrl: agentAvatarUrl(agent),
  }
}
