// Adapts persisted conversation transcript rows (@openbot/db
// conversation_messages) to the conversation entry protocol so the app
// renders them with the existing components. Checkpoints and turns are
// model/scheduler state and deliberately never become transcript rows.

import type { ConversationMessage } from '@openbot/db'
import { YOU } from './data'
import type { ActivityItem, ActivityTab, Author, Entry, ToolCall } from './types'

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

/** Convert persisted transcript rows into renderable entries. */
export function entriesFromMessages(
  rows: ConversationMessage[],
  agent: Author,
): Entry[] {
  const out: Entry[] = []
  for (const row of rows) {
    const time = timeLabel(row.createdAt)
    if (row.kind === 'message' && row.role === 'user') {
      out.push({
        type: 'message',
        id: row.id,
        author: YOU,
        time,
        text: row.bodyText ?? '',
        replyTo: row.replyToEntryId ?? undefined,
      })
    } else if (row.kind === 'message') {
      out.push({
        type: 'message',
        id: row.id,
        author: agent,
        time,
        markdown: row.bodyText ?? '',
        replyTo: row.replyToEntryId ?? undefined,
      })
    } else if (row.kind === 'tool_call' || row.kind === 'tool_result') {
      out.push({ type: 'tool', id: row.id, author: agent, time, call: toolCallFrom(row) })
    } else {
      // status / system / other display events
      out.push({
        type: 'timeline',
        id: row.id,
        text: row.bodyText ?? 'Event',
        time,
        icon: 'notice',
      })
    }
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
