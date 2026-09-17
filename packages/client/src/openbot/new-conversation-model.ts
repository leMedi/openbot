import type { Bot } from './data'

export const MAX_GROUP_NAME_LENGTH = 80

export function matchingConversationAgents(
  agents: readonly Bot[],
  selectedIds: readonly string[],
  query: string,
) {
  const normalized = query.trim().toLocaleLowerCase()
  return agents.filter(
    (agent) =>
      !selectedIds.includes(agent.id) &&
      (!normalized || agent.name.toLocaleLowerCase().includes(normalized)),
  )
}

export function namedConversationGroup(
  firstName: string,
  agents: readonly Pick<Bot, 'name'>[],
) {
  return [firstName.trim(), ...agents.map((agent) => agent.name)]
    .filter(Boolean)
    .join(', ')
    .slice(0, MAX_GROUP_NAME_LENGTH)
}
