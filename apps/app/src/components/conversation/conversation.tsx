import { useCallback, useEffect, useRef, useState } from 'react'
import type { ConversationMessage, Turn, WaitingState } from '@openbot/db'
import { ChevronLeft, PanelRightOpen, Pencil, Square } from 'lucide-react'
import { BotAvatar } from '@/components/openbot/bot-avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { entryFromMessage } from './adapter'
import { Composer } from './composer'
import { YOU } from './data'
import { FullConversationDialog } from './full-conversation'
import type { MessageRowHandlers } from './rows'
import { Transcript } from './transcript'
import { SubagentPanel } from './subagent-panel'
import { streamTurn } from './turn-stream'
import type {
  ActivityTab,
  Author,
  Draft,
  Entry,
  MessageEntry,
  WidgetResponse,
  WidgetView,
  SubagentView,
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
  /** Group members; when present the composed group avatar is shown. */
  members?: Author[]
  initialEntries: Entry[]
  activityTabs: ActivityTab[]
  onEditAgent?: () => void
  /** Inline title rename (double-click the header title). Absent = read-only title. */
  onRenameTitle?: (title: string) => Promise<void> | void
  /**
   * Phone navigation: shows a back chevron and collapses the header to the
   * essentials (the title itself opens the agent editor).
   */
  onBack?: () => void
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
  onListSubagents?: () => Promise<SubagentView[]>
  onSteerSubagent?: (subagentId: string, message: string) => Promise<unknown>
  onStopSubagent?: (subagentId: string) => Promise<unknown>
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
  members,
  initialEntries,
  activityTabs,
  onEditAgent,
  onRenameTitle,
  onBack,
  headerActions,
  readOnly,
  onSendMessage,
  onRespondToTurn,
  onCancelTurn,
  onToggleReaction,
  onRefreshEntries,
  onTurnSettled,
  onListSubagents,
  onSteerSubagent,
  onStopSubagent,
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
    const resumeData = interaction.state.resumeData
    const requiresOauth =
      interaction.state.interactionKind === 'approval' &&
      response.optionId === 'approve' &&
      interaction.state.plugin &&
      resumeData &&
      typeof resumeData === 'object' &&
      !Array.isArray(resumeData) &&
      Array.isArray(resumeData.accountIds) &&
      resumeData.accountIds.length === 0
    if (requiresOauth) {
      const authorization = new URL('/api/mcp/oauth/start', window.location.origin)
      authorization.searchParams.set('pluginKey', interaction.state.plugin!.key)
      authorization.searchParams.set('turnId', interaction.turnId)
      authorization.searchParams.set('toolCallId', interaction.state.originatingToolCall.id)
      window.location.assign(authorization)
      return
    }
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
            if (all.some((e) => e.id === entry.id)) {
              return all.map((existing) => existing.id === entry.id ? entry : existing)
            }
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
      <header className={cn('flex h-12 shrink-0 items-center gap-2 border-b', onBack ? 'px-2' : 'px-4')}>
        {onBack && !inThreadView && (
          <Button variant="ghost" size="icon" aria-label="Back" onClick={onBack} className="-mr-1">
            <ChevronLeft className="size-6" />
          </Button>
        )}
        {(inThreadView || onBack) && (
          <span className={cn('relative', working && 'animate-pulse')}>
            <BotAvatar
              name={agent.name}
              color={agent.color}
              shape={agent.shape}
              src={agent.avatarUrl}
              className="size-5.5 rounded-[7px] text-[10px]"
            />
            {working && <span className="absolute -inset-0.5 rounded-lg border border-primary/60" />}
          </span>
        )}
        {inThreadView ? (
          <>
            <button
              type="button"
              onClick={closeThread}
              className="max-w-56 truncate text-sm font-semibold text-info hover:opacity-80"
            >
              {agent.name}
            </button>
            <span className="text-xs text-muted-foreground/70">›</span>
            <span className="max-w-md truncate text-sm font-semibold">{threadExcerpt}</span>
            <Badge variant="info" className="h-4.5 px-1.5 text-[9px] font-bold tracking-widest">
              THREAD
            </Badge>
          </>
        ) : onBack ? (
          <button
            type="button"
            onClick={onEditAgent}
            disabled={!onEditAgent}
            className="min-w-0 truncate text-sm font-semibold"
          >
            {title ?? agent.name}
          </button>
        ) : (
          <HeaderTitle title={title ?? agent.name} onRename={onRenameTitle} />
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
        {!inThreadView && onListSubagents && onSteerSubagent && onStopSubagent && (
          <SubagentPanel
            load={onListSubagents}
            steer={onSteerSubagent}
            stop={onStopSubagent}
          />
        )}
        <span className="flex-1" />
        {!inThreadView && !onBack && (
          <>
            <HeaderAgents agents={members && members.length > 0 ? members : [agent]} />
            {onEditAgent && (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Edit Bot"
                title="Edit Bot"
                className="text-muted-foreground"
                onClick={onEditAgent}
              >
                <Pencil className="size-3.5" />
              </Button>
            )}
          </>
        )}
        {onBack && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Full conversation"
            className="text-muted-foreground"
            onClick={() => setFullOpen(true)}
          >
            <PanelRightOpen className="size-4" />
          </Button>
        )}
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

/** Header title; double-click to rename inline when `onRename` is provided. */
function HeaderTitle({
  title,
  onRename,
}: {
  title: string
  onRename?: (title: string) => Promise<void> | void
}) {
  const [draft, setDraft] = useState<string | null>(null)

  async function commit() {
    const next = draft?.trim()
    setDraft(null)
    if (!next || next === title || !onRename) return
    await onRename(next)
  }

  if (draft !== null) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void commit()
          if (e.key === 'Escape') setDraft(null)
        }}
        aria-label="Conversation title"
        className="h-7 w-64 rounded-md border border-ring bg-background px-2 text-sm font-semibold outline-none ring-3 ring-ring/30"
      />
    )
  }
  if (!onRename) return <span className="max-w-sm truncate text-sm font-semibold">{title}</span>
  return (
    <span
      title="Double-click to rename"
      onDoubleClick={() => setDraft(title)}
      className="-ml-1.5 max-w-sm cursor-text truncate rounded-md px-1.5 py-0.5 text-sm font-semibold select-none hover:bg-muted"
    >
      {title}
    </span>
  )
}

/** Overlapping avatars of the agents in this conversation (right side of the header). */
function HeaderAgents({ agents }: { agents: Author[] }) {
  const shown = agents.slice(0, 4)
  const extra = agents.length - shown.length
  return (
    <div className="flex items-center pl-1">
      {shown.map((member, index) => (
        <span key={member.id} title={member.name} className={cn(index > 0 && '-ml-1.5')}>
          <BotAvatar
            name={member.name}
            color={member.color}
            shape={member.shape}
            src={member.avatarUrl}
            className={cn('size-5.5 rounded-[7px] text-[10px]', index > 0 && 'border-[1.5px] border-panel')}
          />
        </span>
      ))}
      {extra > 0 && (
        <span className="-ml-1.5 flex size-5.5 items-center justify-center rounded-[7px] border-[1.5px] border-panel bg-muted text-[9px] font-semibold text-muted-foreground">
          +{extra}
        </span>
      )}
    </div>
  )
}
