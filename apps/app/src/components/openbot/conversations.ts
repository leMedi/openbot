// Maps persisted conversations (@openbot/db rows) onto the UI's view model.
// Messages are not persisted yet, so transcripts start empty.

import type { Conversation as ConversationRow } from '@openbot/db'
import type { Conversation } from './data'

function timeLabel(epochMs: number) {
  const date = new Date(epochMs)
  return `${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`
}

/** Unread when marked manually or when transcript rows exist past the read horizon. */
export function isUnread(row: ConversationRow) {
  return row.manuallyUnread || row.lastReadSequenceNo < row.nextSequenceNo - 1
}

export function conversationFromRow(row: ConversationRow): Conversation {
  return {
    id: row.id,
    botId: row.ownerAgentId ?? '',
    title: row.title ?? 'Untitled',
    time: timeLabel(row.updatedAt),
    unread: isUnread(row),
    messages: [],
  }
}
