import { useCallback, useEffect, useRef, useState } from 'react'
import type { ConversationMessage, Turn, WaitingState } from '@openbot/db'
import { ArrowLeft, PanelRightOpen, Pencil, Square } from 'lucide-react'
import { BotAvatar } from '@/components/openbot/bot-avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { entryFromMessage } from './adapter'
import { Composer } from './composer'
import { YOU } from './data'
import { FullConversationDialog } from './full-conversation'
import { GroupAvatar, type MessageRowHandlers } from './rows'
import { Transcript } from './transcript'
import { streamTurn } from './turn-stream'
import type {
  ActivityTab,
  Author,
  Draft,
  Entry,
  MessageEntry,
  WidgetResponse,
  WidgetView,
} from './types'

let seq = 100
const nextId = () => `local-${seq++}`

function nowTime() {
  const d = new Date()
  const h = d.getHours() % 12 || 12
  return `${h}:${String(d.getMinutes()).padStart(2, '0')} ${d.getHours() >= 12 ? 'PM' : 'AM'}`
}

/** Map over every message (top level and inside threads). */
function mapMessages(entries: Entry[], fn: (m: MessageEntry) => MessageEntry): Entry[] {
  return entries.map((e) => {
    if (e.type !== 'message') return e
    const mapped = fn(e)
    return mapped.thread ? { ...mapped, thread: mapped.thread.map(fn) } : mapped
  })
}

export type ConversationProps = {
  /** Stable id — scopes composer drafts. Remount (key) when it changes. */
  id: string
  agent: Author
  /** Header title; falls back to the agent name. */
  title?: string
  model?: string
  /** Group members; when present the composed group avatar is shown. */
  members?: Author[]
  initialEntries: Entry[]
  activityTabs: ActivityTab[]
  onEditAgent?: () => void
  /** Extra header controls (e.g. inspector toggle). */
  headerActions?: React.ReactNode
  /** Read-only conversations hide message actions and the composer. */
  readOnly?: boolean
  /**
   * Durable send boundary: persists the user message and returns its queued
   * agent turn. When absent, sends stay client-local (mock/demo usage).
   */
  onSendMessage?: (draft: Draft) => Promise<{ message: ConversationMessage; turn: Turn }>
  onRespondToTurn?: (input: {
    turnId: string
    text: string
    optionId: string | null
    dismissed: boolean
    toolCallId: string
    requestId: string
    idempotencyKey: string
  }) => Promise<{ message: ConversationMessage; turn: Turn }>
  onCancelTurn?: (turnId: string) => Promise<Turn>
  onToggleReaction?: (messageId: string, reaction: string) => Promise<ConversationMessage>
  /** Poll boundary for messages produced without a user-started turn stream. */
  onRefreshEntries?: () => Promise<Entry[]>
  /** Called after a turn reaches a terminal state (refresh sidebar state etc.). */
  onTurnSettled?: () => void
  /** A queued/running turn to reattach to on mount (reload during a turn). */
  pendingTurnId?: string | null
  /**
   * Resolves the author identity for a persisted message (group rooms map
   * sender agents onto member identities). Defaults to `agent`.
   */
  resolveAuthor?: (message: ConversationMessage) => Author
}

export function Conversation({
  id,
  agent,
  title,
  model,
  members,
  initialEntries,
  activityTabs,
  onEditAgent,
  headerActions,
  readOnly,
  onSendMessage,
  onRespondToTurn,
  onCancelTurn,
  onToggleReaction,
  onRefreshEntries,
  onTurnSettled,
  pendingTurnId,
  resolveAuthor,
}: ConversationProps) {
  const [entries, setEntries] = useState<Entry[]>(initialEntries)
  const [replyTo, setReplyTo] = useState<string | undefined>()
  const [threadRootId, setThreadRootId] = useState<string | null>(null)
  const [threadReplyTo, setThreadReplyTo] = useState<string | undefined>()
  const [fullOpen, setFullOpen] = useState(false)
  const [activeTurnId, setActiveTurnId] = useState<string | null>(pendingTurnId ?? null)
  const [waiting, setWaiting] = useState<{
    turnId: string
    state: WaitingState
    responseIdempotencyKey?: string
  } | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const stickToBottom = useRef(true)
  const cancellingTurns = useRef(new Set<string>())
  const reactionQueues = useRef(new Map<string, Promise<void>>())

  const working = entries.some((e) => e.type === 'message' && e.delivery === 'streaming')
  const oneToOne = !members || members.length === 0

  useEffect(() => {
    const el = scrollRef.current
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight
  }, [entries])

  useEffect(() => {
    stickToBottom.current = true
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [threadRootId])

  const handleScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    const el = event.currentTarget
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 32
  }, [])

  useEffect(() => {
    if (!onRefreshEntries) return
    let stopped = false
    let refreshing = false
    const refresh = async () => {
      if (refreshing) return
      refreshing = true
      try {
        const authoritative = await onRefreshEntries()
        if (stopped) return
        setEntries((current) => {
          const freshById = new Map(authoritative.map((entry) => [entry.id, entry]))
          const next = current.map((entry) => freshById.get(entry.id) ?? entry)
          const known = new Set(current.map((entry) => entry.id))
          next.push(...authoritative.filter((entry) => !known.has(entry.id)))
          return next
        })
      } finally {
        refreshing = false
      }
    }
    const timer = setInterval(() => void refresh().catch(() => {}), 2_000)
    return () => {
      stopped = true
      clearInterval(timer)
    }
  }, [onRefreshEntries])

  // Reattach to a turn that was in flight when this conversation mounted
  // (page reload mid-turn): the stream replays the rows already delivered, or
  // resolves immediately with the persisted result if it finished meanwhile.
  const reattached = useRef(false)
  useEffect(() => {
    if (reattached.current || !pendingTurnId || !onSendMessage) return
    reattached.current = true
    void consumeTurnStream(pendingTurnId)
    // Mount-only by design; the component remounts (key) per conversation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const findEntry = useCallback(
    (entryId: string): Entry | undefined => {
      for (const e of entries) {
        if (e.id === entryId) return e
        if (e.type === 'message' && e.thread) {
          const hit = e.thread.find((t) => t.id === entryId)
          if (hit) return hit
        }
      }
      return undefined
    },
    [entries],
  )

  const applyReactionToggle = useCallback((entryId: string, emoji: string) => {
    setEntries((all) =>
      mapMessages(all, (m) => {
        if (m.id !== entryId) return m
        const reactions = [...(m.reactions ?? [])]
        const i = reactions.findIndex((r) => r.emoji === emoji)
        if (i === -1) {
          reactions.push({ emoji, users: ['You'] })
        } else if (reactions[i].users.includes('You')) {
          const users = reactions[i].users.filter((u) => u !== 'You')
          if (users.length === 0) reactions.splice(i, 1)
          else reactions[i] = { ...reactions[i], users }
        } else {
          reactions[i] = { ...reactions[i], users: [...reactions[i].users, 'You'] }
        }
        return { ...m, reactions }
      }),
    )
  }, [])

  const toggleReaction = useCallback((entryId: string, emoji: string) => {
    applyReactionToggle(entryId, emoji)
    if (!onToggleReaction) return
    const key = `${entryId}:${emoji}`
    const previous = reactionQueues.current.get(key) ?? Promise.resolve()
    const request = previous.catch(() => {}).then(async () => {
      try {
        const message = await onToggleReaction(entryId, emoji)
        if (reactionQueues.current.get(key) !== request) return
        const authoritative = entryFromMessage(
          message,
          resolveAuthor?.(message) ?? agent,
        )
        if (!authoritative || authoritative.type !== 'message') return
        setEntries((all) =>
          mapMessages(all, (entry) =>
            entry.id === entryId
              ? { ...entry, reactions: authoritative.reactions }
              : entry,
          ),
        )
      } catch {
        applyReactionToggle(entryId, emoji)
      } finally {
        if (reactionQueues.current.get(key) === request) {
          reactionQueues.current.delete(key)
        }
      }
    })
    reactionQueues.current.set(key, request)
  }, [agent, applyReactionToggle, onToggleReaction, resolveAuthor])

  const jump = useCallback((entryId: string) => {
    const el = document.getElementById(`entry-${entryId}`)
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    el.classList.add('bg-primary/10')
    setTimeout(() => el.classList.remove('bg-primary/10'), 1200)
  }, [])

  const startThread = useCallback((entryId: string) => {
    setEntries((all) =>
      all.map((e) =>
        e.type === 'message' && e.id === entryId && !e.thread ? { ...e, thread: [] } : e,
      ),
    )
    setThreadRootId(entryId)
  }, [])

  const removeEntry = useCallback((entryId: string) => {
    setEntries((all) => all.filter((e) => e.id !== entryId))
  }, [])

  /**
   * The durable send path: optimistic queued row, atomic server accept
   * (user message + queued turn), then the turn's visible output streamed
   * into a streaming entry until the persisted assistant message replaces it.
   */
  async function sendToServer(draft: Draft) {
    const localId = nextId()
    const idempotencyKey = draft.idempotencyKey ?? crypto.randomUUID()
    const durableDraft = { ...draft, idempotencyKey }
    setEntries((all) => [
      ...all,
      {
        type: 'message',
        id: localId,
        author: YOU,
        time: nowTime(),
        text: draft.prompt,
        attachments: draft.attachments.length > 0 ? draft.attachments : undefined,
        replyTo: draft.replyToId,
        delivery: 'queued',
        idempotencyKey,
      },
    ])
    setReplyTo(undefined)

    let accepted: { message: ConversationMessage; turn: Turn }
    try {
      accepted = await onSendMessage!(durableDraft)
    } catch {
      setEntries((all) =>
        mapMessages(all, (m) => (m.id === localId ? { ...m, delivery: 'failed' } : m)),
      )
      return
    }
    setEntries((all) =>
      mapMessages(all, (m) =>
        m.id === localId ? { ...m, id: accepted.message.id, delivery: 'delivered' } : m,
      ),
    )
    await consumeTurnStream(accepted.turn.id)
  }

  /** Patch the inline widget state of one message entry. */
  const patchWidget = useCallback((entryId: string, patch: Partial<WidgetView>) => {
    setEntries((all) =>
      mapMessages(all, (message) =>
        message.id === entryId && message.widget
          ? { ...message, widget: { ...message.widget, ...patch } }
          : message,
      ),
    )
  }, [])

  /** The entry carrying the widget for the given originating tool call. */
  function widgetEntryIdFor(toolCallId: string) {
    for (const entry of entries) {
      if (entry.type === 'message' && entry.widget?.toolCallId === toolCallId) {
        return entry.id
      }
    }
    return null
  }

  /**
   * Resolve the suspended turn's widget from its inline card: patch the card
   * optimistically, post the response, then stream the resumed turn. On
   * failure the card returns to pending and a retry reuses the same key.
   */
  async function respondToWidget(entryId: string, response: WidgetResponse) {
    if (!waiting || !onRespondToTurn) return
    const interaction = waiting
    const requestId = crypto.randomUUID()
    const idempotencyKey = interaction.responseIdempotencyKey ?? crypto.randomUUID()
    patchWidget(entryId, {
      status: response.dismissed ? 'dismissed' : 'resolved',
      response,
      dismissReason: response.dismissed ? 'manual' : undefined,
    })
    setWaiting(null)
    try {
      const resumed = await onRespondToTurn({
        turnId: interaction.turnId,
        text: response.text,
        optionId: response.optionId,
        dismissed: response.dismissed,
        toolCallId: interaction.state.originatingToolCall.id,
        requestId,
        idempotencyKey,
      })
      await consumeTurnStream(resumed.turn.id)
    } catch {
      setWaiting({ ...interaction, responseIdempotencyKey: idempotencyKey })
      patchWidget(entryId, { status: 'pending', response: undefined, dismissReason: undefined })
    }
  }

  /**
   * Renders one turn's visible output: an empty streaming entry shows the
   * working indicator while delivered messages (SendMessage rows) are
   * inserted ahead of it as they arrive; `done` removes the indicator. Used
   * for freshly sent turns and for reattaching to a turn that was already in
   * flight when the page loaded.
   */
  async function consumeTurnStream(turnId: string) {
    setActiveTurnId(turnId)
    const streamingId = `streaming-${turnId}`
    setEntries((all) => [
      ...all,
      {
        type: 'message',
        id: streamingId,
        author: agent,
        time: nowTime(),
        markdown: '',
        delivery: 'streaming',
      },
    ])
    const replaceStreaming = (entry: Entry) =>
      setEntries((all) => all.map((e) => (e.id === streamingId ? entry : e)))
    let terminal = false
    try {
      await streamTurn(turnId, (event) => {
        if (event.type === 'message') {
          // In a group room the answering member is only known from the
          // persisted message's sender identity.
          const entry = entryFromMessage(
            event.message,
            resolveAuthor?.(event.message) ?? agent,
          )
          if (!entry) return
          // Reattach replays already-rendered rows; insert before the
          // working indicator, once.
          setEntries((all) => {
            if (all.some((e) => e.id === entry.id)) return all
            const index = all.findIndex((e) => e.id === streamingId)
            if (index === -1) return [...all, entry]
            return [...all.slice(0, index), entry, ...all.slice(index)]
          })
        } else if (event.type === 'done') {
          terminal = true
          setEntries((all) => all.filter((e) => e.id !== streamingId))
        } else if (event.type === 'waiting') {
          setEntries((all) => all.filter((entry) => entry.id !== streamingId))
          setWaiting({ turnId: event.turnId, state: event.state })
        } else {
          terminal = true
          replaceStreaming({
            type: 'timeline',
            id: streamingId,
            text:
              event.status === 'cancelled'
                ? `Turn cancelled: ${event.message}`
                : `Turn failed: ${event.message}`,
            time: nowTime(),
            icon: 'notice',
          })
        }
      })
    } catch {
      replaceStreaming({
        type: 'timeline',
        id: streamingId,
        text: 'Lost the turn stream — reload to catch up. The agent keeps working.',
        time: nowTime(),
        icon: 'notice',
      })
    }
    setActiveTurnId((current) => (current === turnId ? null : current))
    if (terminal) onTurnSettled?.()
  }

  function send(draft: Draft, toThread?: string) {
    // Threads are not persisted yet; thread sends stay client-local.
    if (!toThread && waiting && onRespondToTurn) {
      const widgetEntryId = widgetEntryIdFor(waiting.state.originatingToolCall.id)
      if (waiting.state.allowCustom) {
        if (widgetEntryId) {
          void respondToWidget(widgetEntryId, {
            optionId: null,
            text: draft.prompt,
            dismissed: false,
          })
        }
      } else if (waiting.state.dismissOnMoveOn) {
        if (widgetEntryId) {
          patchWidget(widgetEntryId, { status: 'dismissed', dismissReason: 'moveOn' })
        }
        setWaiting(null)
        void sendToServer(draft)
      }
      return
    }
    if (!toThread && onSendMessage) {
      void sendToServer(draft)
      return
    }
    const message: MessageEntry = {
      type: 'message',
      id: nextId(),
      author: YOU,
      time: nowTime(),
      text: draft.prompt,
      attachments: draft.attachments.length > 0 ? draft.attachments : undefined,
      replyTo: draft.replyToId,
    }
    if (toThread) {
      setEntries((all) =>
        all.map((e) =>
          e.type === 'message' && e.id === toThread
            ? { ...e, thread: [...(e.thread ?? []), message] }
            : e,
        ),
      )
      setThreadReplyTo(undefined)
    } else {
      setEntries((all) => [...all, message])
      setReplyTo(undefined)
    }
  }

  // Plain function (not memoized): it must capture the current render's
  // sendToServer, whose props may change between renders.
  function resend(entryId: string) {
    const entry = findEntry(entryId)
    if (onSendMessage && entry?.type === 'message' && entry.text) {
      setEntries((all) => all.filter((e) => e.id !== entryId))
      void sendToServer({
        prompt: entry.text,
        attachments: entry.attachments ?? [],
        idempotencyKey: entry.idempotencyKey,
      })
      return
    }
    setEntries((all) =>
      mapMessages(all, (m) =>
        m.id === entryId ? { ...m, delivery: 'delivered', time: nowTime() } : m,
      ),
    )
  }

  const handlers: MessageRowHandlers = {
    onToggleReaction: toggleReaction,
    onReply: (entryId) => setReplyTo(entryId),
    onStartThread: startThread,
    onOpenThread: (entryId) => setThreadRootId(entryId),
    onJump: jump,
    onResend: resend,
    onDelete: removeEntry,
    onCancelSend: removeEntry,
    findEntry,
    isWidgetActive: (entry) =>
      !!waiting && entry.widget?.toolCallId === waiting.state.originatingToolCall.id,
    onWidgetRespond: (entryId, response) => void respondToWidget(entryId, response),
  }

  const threadHandlers: MessageRowHandlers = {
    ...handlers,
    onReply: (entryId) => setThreadReplyTo(entryId),
    onStartThread: () => {}, // nested thread creation is unavailable
  }

  const threadRoot = threadRootId ? findEntry(threadRootId) : undefined
  const inThreadView = threadRoot?.type === 'message'
  const threadEntries: Entry[] = inThreadView
    ? [threadRoot, ...(threadRoot.thread ?? [])]
    : []
  const threadExcerpt = inThreadView
    ? (threadRoot.text ?? threadRoot.markdown?.split('\n')[0] ?? '…')
    : ''

  function closeThread() {
    setThreadRootId(null)
    setThreadReplyTo(undefined)
  }

  async function cancelTurn(turnId: string) {
    if (!onCancelTurn || cancellingTurns.current.has(turnId)) return
    cancellingTurns.current.add(turnId)
    const interaction = waiting?.turnId === turnId ? waiting : null
    if (interaction) setWaiting(null)
    try {
      await onCancelTurn(turnId)
      if (interaction) await consumeTurnStream(turnId)
    } catch {
      if (interaction) setWaiting(interaction)
    } finally {
      cancellingTurns.current.delete(turnId)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col bg-panel">
      {/* Header */}
      <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
        {inThreadView && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Back to conversation"
            onClick={closeThread}
          >
            <ArrowLeft className="size-4" />
          </Button>
        )}
        <span className={cn('relative', working && 'animate-pulse')}>
          <BotAvatar
            name={agent.name}
            color={agent.color}
            shape={agent.shape}
            src={agent.avatarUrl}
            className="size-6 text-[10px]"
          />
          {working && <span className="absolute -inset-0.5 rounded-lg border border-primary/60" />}
        </span>
        {inThreadView ? (
          <>
            <button
              type="button"
              onClick={closeThread}
              className="max-w-56 truncate text-sm font-semibold text-info hover:opacity-80"
            >
              {title ?? agent.name}
            </button>
            <span className="text-xs text-muted-foreground/70">›</span>
            <span className="max-w-md truncate text-sm font-semibold">{threadExcerpt}</span>
            <Badge variant="info" className="h-4.5 px-1.5 text-[9px] font-bold tracking-widest">
              THREAD
            </Badge>
          </>
        ) : (
          <>
            <span className="max-w-sm truncate text-sm font-semibold">{title ?? agent.name}</span>
            {onEditAgent && (
              <button
                type="button"
                onClick={onEditAgent}
                title="Edit Bot"
                className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                {agent.name}
                <Pencil className="size-2.5" />
              </button>
            )}
            {model && <span className="text-[11px] text-muted-foreground/70">{model}</span>}
            {members && members.length > 0 && <GroupAvatar members={members} />}
          </>
        )}
        {working && (
          <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            Working
            <span className="size-1.5 animate-pulse rounded-full bg-warning" />
          </span>
        )}
        {activeTurnId && onCancelTurn && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Cancel turn"
            onClick={() => void cancelTurn(activeTurnId)}
          >
            <Square className="size-3" />
          </Button>
        )}
        <span className="flex-1" />
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          onClick={() => setFullOpen(true)}
        >
          <PanelRightOpen data-icon="inline-start" /> Full conversation
        </Button>
        {headerActions}
      </header>

      {/* Transcript — the thread view replaces the conversation in place */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="min-h-0 flex-1 overflow-y-auto px-3 pt-4 pb-8"
        >
          {inThreadView ? (
            <Transcript
              entries={threadEntries}
              handlers={threadHandlers}
              inThread
              oneToOne={oneToOne}
              readOnly={readOnly}
            />
          ) : entries.length === 0 ? (
            <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
              No conversation activity yet.
            </div>
          ) : (
            <Transcript
              entries={entries}
              handlers={handlers}
              oneToOne={oneToOne}
              readOnly={readOnly}
            />
          )}
        </div>
        {readOnly ? (
          <div className="mx-4 mb-4 flex items-center justify-center rounded-xl border border-dashed px-3 py-3 text-xs text-muted-foreground/70">
            This conversation is read-only.
          </div>
        ) : waiting && !waiting.state.allowCustom && !waiting.state.dismissOnMoveOn ? (
          <div className="mx-4 mb-4 flex items-center justify-center gap-2 text-xs text-muted-foreground">
            Select an option above to continue.
            {onCancelTurn && (
              <button
                type="button"
                onClick={() => void cancelTurn(waiting.turnId)}
                className="font-medium text-info hover:opacity-80"
              >
                Cancel the turn
              </button>
            )}
          </div>
        ) : (
          <Composer
            agentName={agent.name}
            replyTo={inThreadView ? threadReplyTo : replyTo}
            onCancelReply={() =>
              inThreadView ? setThreadReplyTo(undefined) : setReplyTo(undefined)
            }
            onJumpToReply={jump}
            onSend={(d) => send(d, inThreadView ? threadRoot.id : undefined)}
            findEntry={findEntry}
            draftScope={inThreadView ? `${id}:thread:${threadRoot.id}` : id}
          />
        )}
      </div>

      {fullOpen && (
        <FullConversationDialog
          agentName={agent.name}
          tabs={activityTabs}
          onClose={() => setFullOpen(false)}
        />
      )}
    </div>
  )
}
