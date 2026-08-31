// Types for the Conversation UI (see conversation-spec.md). UI-only mock protocol.

export type Author = {
  id: string
  name: string
  color: string
  /** Avatar shape id (see AVATAR_SHAPES); agents render a shaped avatar. */
  shape?: string
  avatarUrl?: string
  kind: 'user' | 'agent' | 'member'
}

export type Reaction = {
  emoji: string
  /** Display names; 'You' marks the current user. First-seen order is preserved. */
  users: string[]
}

export type DeliveryState =
  | 'delivered'
  | 'streaming'
  | 'queued'
  | 'offline-queued'
  | 'failed'

export type Attachment = {
  id: string
  name: string
  size?: string
  kind: 'file' | 'image' | 'link'
  url?: string
}

export type Card =
  | { kind: 'text'; title: string; body: string }
  | {
      kind: 'links'
      title?: string
      links: { title: string; url: string; desc?: string }[]
    }
  | { kind: 'widget'; title: string; stats: { label: string; value: string }[] }
  | {
      kind: 'connector'
      connector: string
      account: string
      status: 'connected' | 'needs-auth'
    }
  | { kind: 'draft'; title: string; body: string }
  | { kind: 'secret'; name: string; value: string }
  | {
      kind: 'permission'
      action: string
      detail: string
      status: 'pending' | 'approved' | 'denied'
    }
  | {
      kind: 'cloud-agent'
      title: string
      agent: string
      status: 'running' | 'done' | 'error'
    }

export type ToolCall = {
  name: string
  preview: string
  status: 'pending' | 'success' | 'failed'
  detail?: string
}

export type ToolResult = {
  kind: string
  path?: string
  command?: string
  status: string
  output?: string
  diff?: string
  cwd?: string
}

export type VoiceState =
  | { phase: 'idle' }
  | { phase: 'listening'; seconds: number }
  | { phase: 'transcribing' }
  | { phase: 'error'; message: string }

export type MessageEntry = {
  type: 'message'
  id: string
  author: Author
  time: string
  /** Plain text body (user messages, fallbacks). */
  text?: string
  /** Agent markdown body, custom rendered. */
  markdown?: string
  images?: string[]
  channel?: string
  attachments?: Attachment[]
  cards?: Card[]
  reactions?: Reaction[]
  /** Entry id this message replies to; missing targets render "(deleted)". */
  replyTo?: string
  thread?: MessageEntry[]
  delivery?: DeliveryState
  /** Stable across a retry of the same logical send. */
  idempotencyKey?: string
  waitingResponse?: {
    turnId: string
    toolCallId: string
    optionId: string | null
    idempotencyKey: string
  }
}

export type TimelineEntry = {
  type: 'timeline'
  id: string
  text: string
  time?: string
  icon?: 'notice' | 'automation'
}

export type ThinkingEntry = {
  type: 'thinking'
  id: string
  author: Author
  time: string
  text: string
  duration?: string
}

export type ToolEntry = {
  type: 'tool'
  id: string
  author: Author
  time: string
  call: ToolCall
  result?: ToolResult
}

export type Entry = MessageEntry | TimelineEntry | ThinkingEntry | ToolEntry

// Full conversation activity view
export type ActivityItem = {
  kind: 'you' | 'thinking' | 'agent' | 'message' | 'tool'
  text: string
  summary?: string
  toolName?: string
  toolStatus?: 'pending' | 'success' | 'failed'
}

export type ActivityTab = {
  id: string
  /** Root tab has no type; subagent tabs render `<type>: <title>`. */
  subagentType?: string
  title: string
  status?: 'running' | 'done' | 'error' | 'aborted'
  items: ActivityItem[]
}

export type Draft = {
  prompt: string
  richText?: unknown
  attachments: Attachment[]
  replyToId?: string
  isFork?: boolean
  idempotencyKey?: string
}
