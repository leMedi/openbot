// Turn prompt assembly. Conversation history lives in the stored pi session,
// so a private turn only supplies this turn's user text. Group turns run on a
// fresh in-memory session, so they carry the rendered shared transcript.

import { SessionManager } from '@earendil-works/pi-coding-agent'
import {
  listConversationMessages,
  piSessionDirectory,
  type Agent,
  type MemoryItem,
} from '@openbot/db'
import {
  type ConversationPromptContext,
  renderSystemPrompt,
} from './system'

type PrivatePromptInput = {
  conversationId: string
  turnId: string
}

/** The user text posted for this turn (multiple rows join into one prompt). */
async function renderPrivateTurnPrompt(input: PrivatePromptInput): Promise<string> {
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

type GroupPromptInput = {
  agent: Agent
  conversation: Extract<ConversationPromptContext, { kind: 'group' }>
  conversationId: string
}

/**
 * The shared room transcript rendered as one prompt. Group turns are
 * stateless: the whole transcript is rebuilt from the shared conversation on
 * every turn, from this member's perspective.
 */
async function renderGroupTurnPrompt(input: GroupPromptInput): Promise<string> {
  const rows = await listConversationMessages(input.conversationId)
  const nameOf = (agentId: string) =>
    input.conversation.members.find((member) => member.id === agentId)?.name ??
    'Another agent'
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
    `Transcript of the shared room "${input.conversation.group.name}" so far (your earlier messages are prefixed [you]):`,
    '',
    ...lines,
  ].join('\n')
}

export type PrepareConversationTurnInput = {
  agent: Agent
  memory: MemoryItem[]
  conversation: ConversationPromptContext
  conversationId: string
  turnId: string
  workspace: string
  resumedText?: string
  hiddenWakePrompt?: string
}

/** Resolves every private/group execution difference at one boundary. */
export async function prepareConversationTurn(input: PrepareConversationTurnInput) {
  const systemPrompt = renderSystemPrompt({
    agent: input.agent,
    memory: input.memory,
    conversation: input.conversation,
  })

  if (input.conversation.kind === 'group') {
    return {
      systemPrompt,
      sessionManager: SessionManager.inMemory(input.workspace),
      promptText: [
        await renderGroupTurnPrompt({
          agent: input.agent,
          conversation: input.conversation,
          conversationId: input.conversationId,
        }),
        input.hiddenWakePrompt,
      ].filter(Boolean).join('\n\n'),
      senderAgentId: input.agent.id,
    }
  }

  return {
    systemPrompt,
    sessionManager: SessionManager.continueRecent(
      input.workspace,
      await piSessionDirectory(input.conversationId),
    ),
    promptText:
      input.resumedText ??
      input.hiddenWakePrompt ??
      (await renderPrivateTurnPrompt({
        conversationId: input.conversationId,
        turnId: input.turnId,
      })),
    senderAgentId: null,
  }
}
