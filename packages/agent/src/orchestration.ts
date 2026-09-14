export function parseOrchestratorAgentIds(
  response: string,
  allowedAgentIds: ReadonlySet<string>,
) {
  const start = response.indexOf('{')
  const end = response.lastIndexOf('}')
  if (start < 0 || end <= start) return undefined
  try {
    const parsed = JSON.parse(response.slice(start, end + 1)) as { agentIds?: unknown }
    if (!Array.isArray(parsed.agentIds)) return undefined
    const selected = parsed.agentIds.filter(
      (id): id is string => typeof id === 'string' && allowedAgentIds.has(id),
    )
    return [...new Set(selected)]
  } catch {
    return undefined
  }
}

export type GroupRoutingMember = {
  id: string
  name: string
}

export type GroupRoutingMessage = {
  speaker: { kind: 'user' } | { kind: 'member'; id: string }
  content: string
}

export const GROUP_MAX_MEMBER_MESSAGES = 10
export const GROUP_MAX_ROUNDS = 3
export const GROUP_MAX_MESSAGES_PER_MEMBER_TURN = 2

export function isGroupPass(content: string) {
  const trimmed = content.trim()
  return !trimmed || /^\(?\s*pass\s*\)?\.?$/i.test(trimmed)
}

export function orderRoundSpeakers<T>(members: readonly T[], round: number): T[] {
  if (members.length === 0) return []
  const offset = ((round % members.length) + members.length) % members.length
  return [...members.slice(offset), ...members.slice(0, offset)]
}

/** Mention handles accepted for a member: full name, compact full name, and first name. */
export function memberMentionHandles(name: string): string[] {
  const lower = name.trim().toLowerCase()
  if (!lower) return []
  const handles = new Set([lower, lower.replace(/\s+/g, '')])
  const first = lower.split(/\s+/)[0]
  if (first) handles.add(first)
  return [...handles]
}

function isWordChar(char: string | undefined): boolean {
  return char !== undefined && /[a-z0-9]/.test(char)
}

function hasMentionAt(lower: string, handle: string): boolean {
  const needle = `@${handle}`
  for (
    let index = lower.indexOf(needle);
    index >= 0;
    index = lower.indexOf(needle, index + 1)
  ) {
    if (!isWordChar(lower[index - 1]) && !isWordChar(lower[index + needle.length])) {
      return true
    }
  }
  return false
}

export function parseGroupMentions(
  text: string,
  members: readonly GroupRoutingMember[],
): { isEveryone: boolean; memberIds: string[] } {
  const lower = text.toLowerCase()
  const memberIds: string[] = []
  const seen = new Set<string>()
  for (const member of members) {
    if (
      !seen.has(member.id) &&
      memberMentionHandles(member.name).some((handle) => hasMentionAt(lower, handle))
    ) {
      memberIds.push(member.id)
      seen.add(member.id)
    }
  }
  return {
    isEveryone: /(?:^|[^a-z0-9])@(everyone|all)\b/.test(lower),
    memberIds,
  }
}

/** Selects explicitly @mentioned members, or every member when there is no mention. */
export function resolveResponders<T extends GroupRoutingMember>(
  members: readonly T[],
  history: readonly GroupRoutingMessage[],
): T[] {
  let start = 0
  for (let index = history.length - 1; index >= 0; index -= 1) {
    if (history[index]?.speaker.kind === 'user') {
      start = index
      break
    }
  }

  let everyone = false
  const mentioned = new Set<string>()
  for (const message of history.slice(start)) {
    const targets = parseGroupMentions(message.content, members)
    everyone ||= targets.isEveryone
    for (const id of targets.memberIds) mentioned.add(id)
  }

  return everyone || mentioned.size === 0
    ? [...members]
    : members.filter((member) => mentioned.has(member.id))
}
