// Adapts persisted conversation transcript rows (@openbot/db
// conversation_messages) to the conversation entry protocol so the app
// renders them with the existing components. Checkpoints and turns are
// model/scheduler state and deliberately never become transcript rows.

import type { ConversationMessage } from '@openbot/db'
import { YOU } from './data'
import type {
  ActivityItem,
  ActivityTab,
  Attachment,
  Author,
  Entry,
  ToolCall,
} from './types'

function timeLabel(epochMs: number) {
  const d = new Date(epochMs)
  const h = d.getHours() % 12 || 12
  return `${h}:${String(d.getMinutes()).padStart(2, '0')} ${d.getHours() >= 12 ? 'PM' : 'AM'}`
}

type ToolPayload = {
  name?: unknown
  preview?: unknown
  status?: unknown
  detail?: unknown
}

function toolCallFrom(row: ConversationMessage): ToolCall {
  const payload = (row.payloadJson ?? {}) as ToolPayload
  const status = payload.status
  return {
    name: typeof payload.name === 'string' ? payload.name : 'Tool',
    preview:
      typeof payload.preview === 'string' ? payload.preview : (row.bodyText ?? ''),
    status:
      status === 'pending' || status === 'success' || status === 'failed'
        ? status
        : ('success' as const),
    detail: typeof payload.detail === 'string' ? payload.detail : undefined,
  }
}

// Structural view of a SendMessage delivery payload (the zod contract lives
// in @openbot/db json-schemas; the client parses defensively instead of
// importing server runtime code).
type SendMessagePayloadView = {
  deliveryKind?: unknown
  type?: unknown
  widget?: { prompt?: unknown; options?: unknown }
  alt?: unknown
}

function formatBytes(byteSize: number) {
  if (byteSize < 1024) return `${byteSize} B`
  if (byteSize < 1024 * 1024) return `${Math.round(byteSize / 1024)} KB`
  return `${(byteSize / (1024 * 1024)).toFixed(1)} MB`
}

function attachmentsFrom(row: ConversationMessage): Attachment[] {
  return (row.attachmentsJson?.items ?? []).map((item) => {
    const metadata = item.metadata as {
      name?: unknown
      mediaType?: unknown
      byteSize?: unknown
    }
    const mediaType = typeof metadata.mediaType === 'string' ? metadata.mediaType : ''
    return {
      id: item.fileId,
      name: typeof metadata.name === 'string' ? metadata.name : 'file',
      size:
        typeof metadata.byteSize === 'number' ? formatBytes(metadata.byteSize) : undefined,
      kind: mediaType.startsWith('image/') ? ('image' as const) : ('file' as const),
      url: `/api/files/${item.fileId}`,
    }
  })
}

function reactionsFrom(row: ConversationMessage) {
  const grouped = new Map<string, string[]>()
  for (const item of row.reactionsJson.items) {
    const users = grouped.get(item.reaction) ?? []
    users.push(
      item.actorAgentId
        ? 'Agent'
        : item.actorExternalId
          ? item.actorExternalId
          : 'You',
    )
    grouped.set(item.reaction, users)
  }
  return [...grouped].map(([emoji, users]) => ({ emoji, users }))
}

/**
 * One persisted row as a renderable entry, or null for rows the transcript
 * deliberately hides (the internal turn_waiting status duplicates the widget
 * card that precedes it). `author` is the already-resolved identity for
 * agent-authored rows.
 */
export function entryFromMessage(row: ConversationMessage, author: Author): Entry | null {
  const time = timeLabel(row.createdAt)
  if (row.kind === 'message' && row.role === 'user') {
    return {
      type: 'message',
      id: row.id,
      author: YOU,
      time,
      text: row.bodyText ?? '',
      reactions: reactionsFrom(row),
      replyTo: row.replyToEntryId ?? undefined,
    }
  }
  if (row.kind === 'message') {
    const payload = (row.payloadJson ?? {}) as SendMessagePayloadView
    if (payload.deliveryKind === 'send-message' && payload.type === 'widget') {
      const options = Array.isArray(payload.widget?.options) ? payload.widget.options : []
      const labels = options
        .map((option: { label?: unknown }) =>
          typeof option.label === 'string' ? `- ${option.label}` : undefined,
        )
        .filter((line): line is string => !!line)
      return {
        type: 'message',
        id: row.id,
        author,
        time,
        cards: [
          {
            kind: 'text',
            title:
              typeof payload.widget?.prompt === 'string'
                ? payload.widget.prompt
                : (row.bodyText ?? ''),
            body: labels.join('\n'),
          },
        ],
        reactions: reactionsFrom(row),
      }
    }
    if (payload.deliveryKind === 'send-message' && payload.type === 'attachment') {
      return {
        type: 'message',
        id: row.id,
        author,
        time,
        attachments: attachmentsFrom(row),
        reactions: reactionsFrom(row),
      }
    }
    return {
      type: 'message',
      id: row.id,
      author,
      time,
      markdown: row.bodyText ?? '',
      reactions: reactionsFrom(row),
      replyTo: row.replyToEntryId ?? undefined,
    }
  }
  if (row.kind === 'tool_call' || row.kind === 'tool_result') {
    return {
      type: 'tool',
      id: row.id,
      author,
      time,
      call: toolCallFrom(row),
    }
  }
  if (row.kind === 'status' && row.payloadJson.event === 'turn_waiting') {
    return null
  }
  // status / system / other display events
  return {
    type: 'timeline',
    id: row.id,
    text: row.bodyText ?? 'Event',
    time,
    icon: 'notice',
  }
}

/**
 * The author identity for one persisted row: in group rooms the sender agent
 * resolves to its member identity, everywhere else the owning `agent`.
 */
export function authorForMessage(
  row: Pick<ConversationMessage, 'senderAgentId'>,
  agent: Author,
  membersById?: Map<string, Author>,
): Author {
  return (row.senderAgentId && membersById?.get(row.senderAgentId)) || agent
}

/** Convert persisted transcript rows into renderable entries. */
export function entriesFromMessages(
  rows: ConversationMessage[],
  agent: Author,
  /** Group rooms: member identity by sender agent id (falls back to `agent`). */
  membersById?: Map<string, Author>,
): Entry[] {
  const out: Entry[] = []
  for (const row of rows) {
    const entry = entryFromMessage(row, authorForMessage(row, agent, membersById))
    if (entry) out.push(entry)
  }
  return out
}

/** Root activity tab derived from the persisted transcript. */
export function activityFromMessages(
  rows: ConversationMessage[],
  agent: Author,
): ActivityTab[] {
  const items: ActivityItem[] = rows.map((row): ActivityItem => {
    if (row.kind === 'tool_call' || row.kind === 'tool_result') {
      const call = toolCallFrom(row)
      return {
        kind: 'tool',
        text: call.preview,
        toolName: call.name,
        toolStatus: call.status,
      }
    }
    if (row.kind === 'message' && row.role === 'user') {
      return { kind: 'you', text: row.bodyText ?? '' }
    }
    if (row.kind === 'message') {
      return { kind: 'agent', text: row.bodyText ?? '' }
    }
    return { kind: 'message', text: row.bodyText ?? '' }
  })
  return [{ id: 'root', title: agent.name, items }]
}
