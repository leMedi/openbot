// Adapts the OpenBot mock conversations (components/openbot/data.ts) to the
// conversation entry protocol so the app renders them with the new components.

import {
  botById,
  type Conversation as BotConversation,
  type Message as BotMessage,
} from '@/components/openbot/data'
import { YOU } from './data'
import type { ActivityTab, Author, Card, Entry, MessageEntry } from './types'

export function agentAuthor(botId: string): Author {
  const bot = botById(botId)
  return { id: bot.id, name: bot.name, color: bot.color, kind: 'agent' }
}

function toMarkdown(m: BotMessage): string {
  const parts: string[] = []
  if (m.title) parts.push(`**${m.title}**`)
  if (m.text) parts.push(m.text)
  if (m.items && m.items.length > 0) {
    parts.push(m.items.map((it) => `- \`${it.key}\` — ${it.val}`).join('\n'))
  }
  if (m.choice) {
    parts.push(
      m.choice.options
        .map((o, i) => `${i + 1}. ${o.label}${o.hint ? ` — *${o.hint}*` : ''}`)
        .join('\n'),
    )
  }
  if (m.remote) parts.push(`Live at \`${m.remote.url}\` on the shared machine.`)
  return parts.join('\n\n')
}

function toCards(m: BotMessage): Card[] | undefined {
  const cards: Card[] = []
  if (m.permission) {
    cards.push({
      kind: 'permission',
      action: m.permission.action,
      detail: `${m.permission.plugin} · ${m.permission.account} — ${m.permission.preview}`,
      status: m.permission.status,
    })
  }
  if (m.access) {
    cards.push({
      kind: 'permission',
      action: `Access request — ${m.access.plugin} (${m.access.account})`,
      detail: 'The bot needs this account to continue. Granting applies to this bot only.',
      status: m.access.status === 'granted' ? 'approved' : m.access.status,
    })
  }
  if (m.remote) {
    cards.push({
      kind: 'cloud-agent',
      title: m.remote.blocker,
      agent: `remote: ${m.remote.machine}`,
      status: m.remote.status === 'stuck' ? 'error' : 'running',
    })
  }
  return cards.length > 0 ? cards : undefined
}

function toMessage(m: BotMessage, agent: Author): MessageEntry {
  const isUser = m.role === 'user'
  return {
    type: 'message',
    id: m.id,
    author: isUser ? YOU : agent,
    time: m.time,
    text: isUser ? m.text : undefined,
    markdown: isUser ? undefined : toMarkdown(m),
    cards: toCards(m),
    thread: m.thread?.map((t) => toMessage(t, agent)),
  }
}

/** Convert one OpenBot mock conversation into transcript entries. */
export function entriesFor(convo: BotConversation): Entry[] {
  const agent = agentAuthor(convo.botId)
  const out: Entry[] = []
  for (const m of convo.messages) {
    if (m.routine) {
      out.push({
        type: 'timeline',
        id: `${m.id}-routine`,
        text: `Routine “${m.routine}” ran`,
        time: m.time,
        icon: 'automation',
      })
    }
    if (m.delegation) {
      out.push({
        type: 'tool',
        id: `${m.id}-delegation`,
        author: agent,
        time: m.time,
        call: {
          name: `Asked ${m.delegation.toName}`,
          preview:
            m.delegation.status === 'done'
              ? `answered${m.delegation.duration ? ` in ${m.delegation.duration}` : ''}`
              : 'working…',
          status: m.delegation.status === 'done' ? 'success' : 'pending',
        },
      })
    }
    out.push(toMessage(m, agent))
  }
  return out
}

/** Root activity tab derived from the transcript. */
export function activityFor(convo: BotConversation): ActivityTab[] {
  const agent = agentAuthor(convo.botId)
  return [
    {
      id: 'root',
      title: agent.name,
      items: convo.messages.map((m) => ({
        kind: m.role === 'user' ? ('you' as const) : ('agent' as const),
        text: m.text,
      })),
    },
  ]
}
