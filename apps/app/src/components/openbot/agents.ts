// Maps persisted agents (@openbot/db rows, fetched through server functions)
// onto the UI's Bot view model so persisted and mock bots render the same way.

import type { Agent } from '@openbot/db'
import { BOT_COLORS, type Bot } from './data'

export function agentColor(agentId: string) {
  let hash = 0
  for (const char of agentId) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return BOT_COLORS[hash % BOT_COLORS.length]
}

export function agentAvatarUrl(agent: Agent) {
  if (!agent.avatarFileId) return undefined
  return `/api/agents/${agent.id}/avatar?v=${encodeURIComponent(agent.avatarFileId)}`
}

export function botFromAgent(agent: Agent, model: string): Bot {
  return {
    id: agent.id,
    name: agent.name,
    color: agentColor(agent.id),
    // The server-configured model applies to every agent until the model
    // providers and listing feature lands.
    model,
    prompt: agent.description,
    grants: [],
    memory: '',
    avatarUrl: agentAvatarUrl(agent),
  }
}
