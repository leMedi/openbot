import { useCallback, useEffect, useRef, useState } from 'react'
import type { ConversationMessage, Turn } from '@openbot/db'
import { ArrowLeft, PanelRightOpen, Pencil } from 'lucide-react'
import { BotAvatar } from '@/components/openbot/bot-avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { Composer } from './composer'
import { YOU } from './data'
import { FullConversationDialog } from './full-conversation'
import { GroupAvatar, type MessageRowHandlers } from './rows'
import { Transcript } from './transcript'
import { streamTurn } from './turn-stream'
import type { ActivityTab, Author, Draft, Entry, MessageEntry } from './types'

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
  /** Called after a turn reaches a terminal state (refresh sidebar state etc.). */
  onTurnSettled?: () => void
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
  onTurnSettled,
}: ConversationProps) {
  const [entries, setEntries] = useState<Entry[]>(initialEntries)
  const [replyTo, setReplyTo] = useState<string | undefined>()
  const [threadRootId, setThreadRootId] = useState<string | null>(null)
  const [threadReplyTo, setThreadReplyTo] = useState<string | undefined>()
  const [fullOpen, setFullOpen] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  const working = entries.some((e) => e.type === 'message' && e.delivery === 'streaming')
  const oneToOne = !members || members.length === 0

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [entries, threadRootId])

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

  const toggleReaction = useCallback((entryId: string, emoji: string) => {
    // Optimistic update; a real client would reconcile with the event stream.
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
      },
    ])
    setReplyTo(undefined)

    let accepted: { message: ConversationMessage; turn: Turn }
    try {
      accepted = await onSendMessage!(draft)
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

    const streamingId = `streaming-${accepted.turn.id}`
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
    try {
      await streamTurn(accepted.turn.id, (event) => {
        if (event.type === 'delta') {
          setEntries((all) =>
            mapMessages(all, (m) =>
              m.id === streamingId
                ? { ...m, markdown: (m.markdown ?? '') + event.text }
                : m,
            ),
          )
        } else if (event.type === 'done') {
          setEntries((all) =>
            mapMessages(all, (m) =>
              m.id === streamingId
                ? {
                    ...m,
                    id: event.message.id,
                    markdown: event.message.bodyText ?? '',
                    delivery: 'delivered',
                  }
                : m,
            ),
          )
        } else {
          replaceStreaming({
            type: 'timeline',
            id: streamingId,
            text: `Turn failed: ${event.message}`,
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
    onTurnSettled?.()
  }

  function send(draft: Draft, toThread?: string) {
    // Threads are not persisted yet; thread sends stay client-local.
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

  const resend = useCallback(
    (entryId: string) => {
      const entry = findEntry(entryId)
      if (onSendMessage && entry?.type === 'message' && entry.text) {
        setEntries((all) => all.filter((e) => e.id !== entryId))
        void sendToServer({ prompt: entry.text, attachments: entry.attachments ?? [] })
        return
      }
      setEntries((all) =>
        mapMessages(all, (m) =>
          m.id === entryId ? { ...m, delivery: 'delivered', time: nowTime() } : m,
        ),
      )
    },
    // sendToServer is re-created per render but only captures stable setters/props.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [findEntry, onSendMessage],
  )

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
      <div className="flex min-w-0 flex-1 flex-col">
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
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
