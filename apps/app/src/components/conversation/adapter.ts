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
  ToolResult,
  WidgetOption,
  WidgetResponse,
  WidgetView,
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
  outcome?: unknown
  display?: unknown
  cursor?: unknown
  screenshot?: unknown
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

function toolResultFrom(row: ConversationMessage): ToolResult {
  const payload = (row.payloadJson ?? {}) as ToolPayload
  const screenshot =
    payload.screenshot && typeof payload.screenshot === 'object'
      ? (payload.screenshot as Record<string, unknown>)
      : undefined
  const display =
    payload.display && typeof payload.display === 'object'
      ? (payload.display as Record<string, unknown>)
      : undefined
  const cursor =
    payload.cursor && typeof payload.cursor === 'object'
      ? (payload.cursor as Record<string, unknown>)
      : screenshot?.cursor && typeof screenshot.cursor === 'object'
        ? (screenshot.cursor as Record<string, unknown>)
        : undefined
  const fileId = typeof screenshot?.fileId === 'string' ? screenshot.fileId : undefined
  const width =
    typeof screenshot?.width === 'number'
      ? screenshot.width
      : typeof display?.width === 'number'
        ? display.width
        : undefined
  const height =
    typeof screenshot?.height === 'number'
      ? screenshot.height
      : typeof display?.height === 'number'
        ? display.height
        : undefined
  return {
    kind: typeof payload.name === 'string' ? payload.name : 'Tool result',
    status: typeof payload.outcome === 'string' ? payload.outcome.replaceAll('_', ' ') : 'complete',
    output: row.bodyText ?? undefined,
    ...(fileId && { imageUrl: `/api/files/${fileId}`, imageAlt: 'Remote Desktop screenshot' }),
    ...(width !== undefined && height !== undefined
      ? { dimensions: { width, height } }
      : {}),
    ...(typeof cursor?.x === 'number' && typeof cursor.y === 'number'
      ? { cursor: { x: cursor.x, y: cursor.y } }
      : {}),
  }
}

// Structural view of a SendMessage delivery payload (the zod contract lives
// in @openbot/db json-schemas; the client parses defensively instead of
// importing server runtime code).
type SendMessagePayloadView = {
  deliveryKind?: unknown
  type?: unknown
  toolCallId?: unknown
  event?: unknown
  senderAgentName?: unknown
  widget?: {
    prompt?: unknown
    helpText?: unknown
    options?: unknown
    interactionKind?: unknown
    allowCustom?: unknown
    dismissOnMoveOn?: unknown
    plugin?: { key?: unknown; name?: unknown }
  }
  alt?: unknown
}

function widgetOptionsFrom(raw: unknown): WidgetOption[] {
  if (!Array.isArray(raw)) return []
  const options: WidgetOption[] = []
  for (const item of raw as {
    id?: unknown
    label?: unknown
    description?: unknown
    style?: unknown
  }[]) {
    if (typeof item.id !== 'string' || typeof item.label !== 'string') continue
    options.push({
      id: item.id,
      label: item.label,
      ...(typeof item.description === 'string' && { description: item.description }),
      ...((item.style === 'primary' || item.style === 'danger') && { style: item.style }),
    })
  }
  return options
}

function widgetViewFrom(
  payload: SendMessagePayloadView,
  response: WidgetResponse | undefined,
): WidgetView | null {
  const widget = payload.widget
  if (!widget || typeof payload.toolCallId !== 'string') return null
  const plugin =
    widget.plugin &&
    typeof widget.plugin.key === 'string' &&
    typeof widget.plugin.name === 'string'
      ? { key: widget.plugin.key, name: widget.plugin.name }
      : undefined
  return {
    toolCallId: payload.toolCallId,
    kind: widget.interactionKind === 'approval' ? 'approval' : 'question',
    ...(typeof widget.helpText === 'string' && { helpText: widget.helpText }),
    options: widgetOptionsFrom(widget.options),
    allowCustom: widget.allowCustom === true,
    dismissOnMoveOn: widget.dismissOnMoveOn === true,
    ...(plugin && { plugin }),
    status: response ? (response.dismissed ? 'dismissed' : 'resolved') : 'pending',
    ...(response && { response }),
    ...(response?.dismissed && { dismissReason: 'manual' as const }),
  }
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
 * card, and turn_response rows surface as the widget's answer line instead).
 * `author` is the already-resolved identity for agent-authored rows;
 * `widgetResponse` is this row's answer when it is a widget delivery.
 */
export function entryFromMessage(
  row: ConversationMessage,
  author: Author,
  widgetResponse?: WidgetResponse,
): Entry | null {
  const time = timeLabel(row.createdAt)
  if (row.kind === 'message' && row.role === 'user') {
    const payload = (row.payloadJson ?? {}) as SendMessagePayloadView
    if (payload.event === 'turn_response') return null
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
      const widget = widgetViewFrom(payload, widgetResponse)
      return {
        type: 'message',
        id: row.id,
        author,
        time,
        markdown:
          typeof payload.widget?.prompt === 'string'
            ? payload.widget.prompt
            : (row.bodyText ?? ''),
        ...(widget && { widget }),
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
      ...(row.kind === 'tool_result' && { result: toolResultFrom(row) }),
    }
  }
  if (row.kind === 'status' && row.payloadJson.event === 'turn_waiting') {
    return null
  }
  if (row.kind === 'status' && row.payloadJson.event === 'computer-use-audit') {
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
 * Resolve a persisted sender to a live agent, or to the denormalized direct-
 * message identity when that agent has since been deleted.
 */
export function authorForMessage(
  row: Pick<ConversationMessage, 'id' | 'senderAgentId' | 'payloadJson'>,
  agent: Author,
  membersById?: Map<string, Author>,
): Author {
  const known = row.senderAgentId && membersById?.get(row.senderAgentId)
  if (known) return known
  const payload = row.payloadJson as SendMessagePayloadView
  if (
    payload.event === 'direct-agent-message' &&
    typeof payload.senderAgentName === 'string'
  ) {
    return {
      ...agent,
      id: row.senderAgentId ?? `deleted:${row.id}`,
      name: payload.senderAgentName,
      kind: 'agent',
    }
  }
  return agent
}

/** Convert persisted transcript rows into renderable entries. */
export function entriesFromMessages(
  rows: ConversationMessage[],
  agent: Author,
  /** Known agent identities by sender id (falls back to persisted provenance). */
  membersById?: Map<string, Author>,
): Entry[] {
  const widgetResponses = widgetResponsesFromMessages(rows)
  const out: Entry[] = []
  for (const row of rows) {
    const payload = row.payloadJson as SendMessagePayloadView
    const entry = entryFromMessage(
      row,
      authorForMessage(row, agent, membersById),
      typeof payload.toolCallId === 'string'
        ? widgetResponses.get(payload.toolCallId)
        : undefined,
    )
    if (entry) out.push(entry)
  }
  return out
}

/** Widget answers by originating tool-call id, from persisted turn_response rows. */
export function widgetResponsesFromMessages(rows: ConversationMessage[]) {
  const responses = new Map<string, WidgetResponse>()
  for (const row of rows) {
    const payload = row.payloadJson as {
      event?: unknown
      optionId?: unknown
      dismissed?: unknown
      toolCallId?: unknown
    }
    if (payload.event === 'turn_response' && typeof payload.toolCallId === 'string') {
      responses.set(payload.toolCallId, {
        optionId: typeof payload.optionId === 'string' ? payload.optionId : null,
        text: row.bodyText ?? '',
        dismissed: payload.dismissed === true,
      })
    }
  }
  return responses
}

/** Root activity tab derived from the persisted transcript. */
export function activityFromMessages(
  rows: ConversationMessage[],
  agent: Author,
): ActivityTab[] {
  const items: ActivityItem[] = rows
    .filter((row) => row.payloadJson.event !== 'computer-use-audit')
    .map((row): ActivityItem => {
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
