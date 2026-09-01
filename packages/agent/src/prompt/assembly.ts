// Turn prompt assembly. Conversation history lives in the stored pi session,
// so a private turn only supplies this turn's user text. Group turns run on a
// fresh in-memory session, so they carry the rendered shared transcript.

import { listConversationMessages, type Agent, type Group } from '@openbot/db'

export type PrivatePromptInput = {
  conversationId: string
  turnId: string
}

/** The user text posted for this turn (multiple rows join into one prompt). */
export async function renderPrivateTurnPrompt(input: PrivatePromptInput): Promise<string> {
  const rows = await listConversationMessages(input.conversationId)
  return rows
    .filter(
      (message) =>
        message.turnId === input.turnId &&
        message.kind === 'message' &&
        message.role === 'user',
    )
    .map((message) => message.bodyText ?? '')
    .join('\n\n')
}

export type GroupPromptInput = {
  agent: Agent
  group: Group
  members: Agent[]
  conversationId: string
}

/**
 * The shared room transcript rendered as one prompt. Group turns are
 * stateless: the whole transcript is rebuilt from the shared conversation on
 * every turn, from this member's perspective.
 */
export async function renderGroupTurnPrompt(input: GroupPromptInput): Promise<string> {
  const rows = await listConversationMessages(input.conversationId)
  const nameOf = (agentId: string) =>
    input.members.find((member) => member.id === agentId)?.name ?? 'Another agent'
  const lines: string[] = []
  for (const row of rows) {
    if (row.kind !== 'message' || !row.bodyText) continue
    if (row.role === 'user') {
      lines.push(`[user]: ${row.bodyText}`)
    } else if (row.senderAgentId === input.agent.id) {
      lines.push(`[you]: ${row.bodyText}`)
    } else if (row.senderAgentId) {
      lines.push(`[${nameOf(row.senderAgentId)}]: ${row.bodyText}`)
    }
  }
  return [
    `Transcript of the shared room "${input.group.name}" so far (your earlier messages are prefixed [you]):`,
    '',
    ...lines,
    '',
    'Continue the conversation as yourself, without a name prefix. Deliver ' +
      'your reply by actually invoking the SendMessage tool — plain assistant ' +
      'text is never shown to the room.',
  ].join('\n')
}
