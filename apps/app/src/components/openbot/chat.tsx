import { useState } from 'react'
import {
  ArrowUp,
  Copy,
  MessageCircle,
  MoreHorizontal,
  PanelRight,
  Paperclip,
  Pencil,
  Reply,
  X,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { BotAvatar } from './bot-avatar'
import { botById, type Bot, type Conversation, type Message } from './data'

type ChatProps = {
  conversation: Conversation
  openThreadId: string | null
  onOpenThread: (msgId: string | null) => void
  onToggleInspector: () => void
  onEditBot: (bot: Bot) => void
}

export function Chat({
  conversation,
  openThreadId,
  onOpenThread,
  onToggleInspector,
  onEditBot,
}: ChatProps) {
  const bot = botById(conversation.botId)
  const [draft, setDraft] = useState('')
  const [replyTo, setReplyTo] = useState<Message | null>(null)

  const threadRoot = openThreadId
    ? conversation.messages.find((m) => m.id === openThreadId)
    : null
  const messages = threadRoot
    ? [threadRoot, ...(threadRoot.thread ?? [])]
    : conversation.messages

  return (
    <div className="flex min-w-0 flex-1 flex-col bg-panel">
      {/* Header */}
      <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
        <BotAvatar name={bot.name} color={bot.color} className="size-5.5 text-[10px]" />
        {threadRoot ? (
          <>
            <button
              type="button"
              onClick={() => onOpenThread(null)}
              className="text-sm font-semibold text-info hover:opacity-80"
            >
              {bot.name}
            </button>
            <span className="text-xs text-muted-foreground/70">›</span>
            <div className="max-w-md truncate text-sm font-semibold">{threadRoot.text}</div>
            <Badge variant="info" className="h-4.5 px-1.5 text-[9px] font-bold tracking-widest">
              THREAD
            </Badge>
          </>
        ) : (
          <>
            <div className="max-w-sm truncate text-sm font-semibold">{conversation.title}</div>
            <button
              type="button"
              onClick={() => onEditBot(bot)}
              title="Edit Bot"
              className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              {bot.name}
              <Pencil className="size-2.5" />
            </button>
            <div className="text-[11px] text-muted-foreground/70">{bot.model}</div>
          </>
        )}
        <div className="flex-1" />
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Toggle inspector"
          onClick={onToggleInspector}
        >
          <PanelRight className="size-4" />
        </Button>
      </header>

      {/* Messages */}
      <div className="flex flex-1 flex-col gap-3.5 overflow-y-auto px-9 pt-6 pb-2">
        <div className="text-center text-[11px] font-medium text-muted-foreground/70">
          {threadRoot ? 'Thread' : `Conversation with ${bot.name}`}
        </div>
        {messages.map((m) => (
          <MessageRow
            key={m.id}
            message={m}
            bot={bot}
            inThread={!!threadRoot}
            onOpenThread={() => onOpenThread(m.id)}
            onReply={() => setReplyTo(m)}
          />
        ))}
        <div className="h-2 shrink-0" />
      </div>

      {/* Composer */}
      <div className="px-9 pb-5">
        {replyTo && (
          <div className="flex items-center gap-2.5 rounded-t-xl border border-b-0 bg-card/60 px-3 py-2">
            <div className="w-0.5 self-stretch rounded-full bg-primary" />
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-bold text-info">
                Replying to {replyTo.role === 'user' ? 'you' : bot.name}
              </div>
              <div className="truncate text-xs text-muted-foreground">{replyTo.text}</div>
            </div>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Cancel reply"
              onClick={() => setReplyTo(null)}
            >
              <X />
            </Button>
          </div>
        )}
        <form
          className={cn(
            'flex items-center gap-1.5 border bg-background/60 p-1 pl-2',
            replyTo ? 'rounded-b-xl' : 'rounded-xl',
          )}
          onSubmit={(e) => {
            e.preventDefault()
            setDraft('')
            setReplyTo(null)
          }}
        >
          <Button variant="ghost" size="icon-sm" aria-label="Attach files" type="button">
            <Paperclip className="size-3.5" />
          </Button>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={`Message ${bot.name} — type / for skills`}
            className="flex-1 bg-transparent py-2 text-sm outline-none placeholder:text-muted-foreground/70"
          />
          <Button
            size="icon-sm"
            aria-label="Send"
            type="submit"
            className={cn(!draft && 'bg-muted text-muted-foreground hover:bg-muted')}
          >
            <ArrowUp className="size-3.5" />
          </Button>
        </form>
      </div>
    </div>
  )
}

function MessageRow({
  message: m,
  bot,
  inThread,
  onOpenThread,
  onReply,
}: {
  message: Message
  bot: Bot
  inThread: boolean
  onOpenThread: () => void
  onReply: () => void
}) {
  const isUser = m.role === 'user'

  return (
    <div className={cn('group flex animate-rise', isUser ? 'justify-end' : 'justify-start')}>
      <div className="relative max-w-[60%] min-w-0">
        {/* Hover actions */}
        <div
          className={cn(
            'absolute top-1/2 hidden -translate-y-1/2 items-center gap-0.5 group-hover:flex',
            isUser ? 'right-full mr-1' : 'left-full ml-1',
          )}
        >
          <Button variant="ghost" size="icon-sm" aria-label="Reply" onClick={onReply}>
            <Reply className="size-3.5" />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button variant="ghost" size="icon-sm" aria-label="More">
                  <MoreHorizontal className="size-3.5" />
                </Button>
              }
            />
            <DropdownMenuContent align={isUser ? 'end' : 'start'} className="w-40">
              <DropdownMenuItem>
                <Copy /> Copy text
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onReply}>
                <Reply /> Reply
              </DropdownMenuItem>
              {!isUser && !inThread && (
                <DropdownMenuItem onClick={onOpenThread}>
                  <MessageCircle /> Reply in thread
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Kicker rows */}
        {m.routine && (
          <div className="mb-1.5 flex items-center gap-2">
            <Badge variant="success" className="h-4.5 px-1.5 text-[9px] font-bold tracking-widest">
              ROUTINE
            </Badge>
            <span className="text-[11px] text-muted-foreground">
              {m.routine} · {m.time}
            </span>
          </div>
        )}
        {m.permission?.status === 'pending' && (
          <div className="mb-1.5 flex items-center gap-2">
            <Badge variant="warning" className="h-4.5 px-1.5 text-[9px] font-bold tracking-widest">
              NEEDS APPROVAL
            </Badge>
            <span className="text-[11px] text-muted-foreground">{m.time}</span>
          </div>
        )}
        {m.access?.status === 'pending' && (
          <div className="mb-1.5 flex items-center gap-2">
            <Badge variant="info" className="h-4.5 px-1.5 text-[9px] font-bold tracking-widest">
              ACCESS REQUEST
            </Badge>
            <span className="text-[11px] text-muted-foreground">{m.time}</span>
          </div>
        )}
        {m.delegation && (
          <div className="mb-1.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="flex items-center">
              <BotAvatar name={bot.name} color={bot.color} className="size-3.5 rounded-sm text-[7px]" />
              <BotAvatar
                name={m.delegation.toName}
                color="#8a5fc4"
                className="-ml-1 size-3.5 rounded-sm border border-panel text-[7px]"
              />
            </span>
            <span className="font-medium">Asked {m.delegation.toName}</span>
            <span
              className={cn(
                'size-1 rounded-full',
                m.delegation.status === 'done' ? 'bg-success' : 'bg-warning animate-typing-dot',
              )}
            />
            <span className={m.delegation.status === 'done' ? 'text-success' : 'text-warning'}>
              {m.delegation.status === 'done'
                ? `Answered${m.delegation.duration ? ` in ${m.delegation.duration}` : ''}`
                : 'Working…'}
            </span>
          </div>
        )}

        {/* Bubble */}
        <div
          className={cn(
            'rounded-xl px-3.5 py-2.5 text-sm leading-relaxed',
            isUser ? 'bg-primary text-white' : 'bg-card text-foreground',
          )}
        >
          {m.title && <div className="mb-1.5 font-semibold">{m.title}</div>}
          <div>{m.text}</div>
          {m.items && (
            <div className="mt-2.5 flex flex-col gap-1.5 border-t border-white/10 pt-2">
              {m.items.map((it) => (
                <div key={it.key} className="flex items-baseline gap-2.5">
                  <span
                    className={cn(
                      'shrink-0 font-mono text-[11px] font-semibold',
                      isUser ? 'text-white/80' : 'text-info',
                    )}
                  >
                    {it.key}
                  </span>
                  <span className={cn('text-xs', isUser ? 'text-white/90' : 'text-muted-foreground')}>
                    {it.val}
                  </span>
                </div>
              ))}
            </div>
          )}
          {m.permission && <PermissionCard message={m} />}
          {m.access && <AccessCard message={m} />}
          {m.choice && <ChoiceCard message={m} />}
          {m.remote && <RemoteCard message={m} />}
        </div>

        {/* Thread link */}
        {m.thread && !inThread && (
          <div className={cn('flex', isUser ? 'justify-end' : 'justify-start')}>
            <button
              type="button"
              onClick={onOpenThread}
              className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-semibold text-info hover:opacity-80"
            >
              <Reply className="size-3" />
              {m.thread.length} {m.thread.length === 1 ? 'reply' : 'replies'} ›
            </button>
          </div>
        )}
        {isUser && (
          <div className="mt-1 text-right text-[10px] text-muted-foreground/70">{m.time}</div>
        )}
      </div>
    </div>
  )
}

function CardShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-2.5 overflow-hidden rounded-lg border bg-background/40">{children}</div>
  )
}

function StatusLine({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="flex items-center gap-1.5 border-t px-3 py-2">
      <span className={cn('size-1.5 rounded-full', ok ? 'bg-success' : 'bg-destructive')} />
      <span
        className={cn('text-[11px] font-medium', ok ? 'text-success' : 'text-destructive')}
      >
        {label}
      </span>
    </div>
  )
}

function PermissionCard({ message: m }: { message: Message }) {
  const perm = m.permission!
  const [status, setStatus] = useState(perm.status)

  return (
    <CardShell>
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <BotAvatar name={perm.plugin} color="#8fbe5f" className="size-4.5 rounded-sm text-[8px]" />
        <div className="min-w-0 flex-1 truncate text-xs font-semibold">{perm.action}</div>
        <div className="text-[10px] text-muted-foreground/70">{perm.account}</div>
      </div>
      <div className="bg-background/50 px-3 py-2 font-mono text-[11px] leading-relaxed text-muted-foreground">
        {perm.preview}
      </div>
      {status === 'pending' ? (
        <div className="flex gap-2 border-t px-3 py-2">
          <Button size="xs" onClick={() => setStatus('approved')}>
            Approve &amp; run
          </Button>
          <Button size="xs" variant="outline" onClick={() => setStatus('denied')}>
            Deny
          </Button>
        </div>
      ) : (
        <StatusLine
          ok={status === 'approved'}
          label={status === 'approved' ? 'Approved — posted' : 'Denied'}
        />
      )}
    </CardShell>
  )
}

function AccessCard({ message: m }: { message: Message }) {
  const access = m.access!
  const [status, setStatus] = useState(access.status)

  return (
    <CardShell>
      <div className="flex items-center gap-2 px-3 py-2">
        <BotAvatar name={access.plugin} color="#4a4a4f" className="size-4.5 rounded-sm text-[8px]" />
        <div className="min-w-0 flex-1 truncate text-xs font-semibold">
          {access.plugin} — {access.account}
        </div>
      </div>
      {status === 'pending' ? (
        <div className="flex gap-2 border-t px-3 py-2">
          <Button size="xs" onClick={() => setStatus('granted')}>
            Grant access
          </Button>
          <Button size="xs" variant="outline" onClick={() => setStatus('denied')}>
            Deny
          </Button>
        </div>
      ) : (
        <StatusLine
          ok={status === 'granted'}
          label={status === 'granted' ? 'Access granted' : 'Denied'}
        />
      )}
    </CardShell>
  )
}

function ChoiceCard({ message: m }: { message: Message }) {
  const choice = m.choice!
  const [selected, setSelected] = useState<string[]>([])
  const [resolved, setResolved] = useState(choice.status === 'resolved')

  function pick(id: string) {
    if (resolved) return
    if (choice.multi) {
      setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))
    } else {
      setSelected([id])
      setResolved(true)
    }
  }

  const answer = choice.options
    .filter((o) => selected.includes(o.id))
    .map((o) => o.label)
    .join(', ')

  return (
    <div className="mt-2.5 flex flex-col gap-1.5">
      {choice.options.map((o) => {
        const isSel = selected.includes(o.id)
        return (
          <button
            key={o.id}
            type="button"
            onClick={() => pick(o.id)}
            disabled={resolved && !isSel}
            className={cn(
              'flex items-center gap-2 rounded-lg border px-3 py-2 text-left',
              isSel ? 'border-primary/60 bg-primary/15' : 'hover:border-foreground/25',
              resolved && !isSel && 'opacity-50',
            )}
          >
            <span
              className={cn(
                'flex size-3.5 shrink-0 items-center justify-center border text-[9px] font-bold text-white',
                choice.multi ? 'rounded-sm' : 'rounded-full',
                isSel ? 'border-primary bg-primary' : 'border-muted-foreground/50',
              )}
            >
              {isSel ? '✓' : ''}
            </span>
            <span className="min-w-0 flex-1 text-xs font-medium">{o.label}</span>
            {o.hint && <span className="shrink-0 text-[10px] text-muted-foreground/70">{o.hint}</span>}
          </button>
        )
      })}
      {choice.multi && !resolved && (
        <Button
          size="xs"
          className="mt-0.5 self-start"
          disabled={selected.length === 0}
          onClick={() => setResolved(true)}
        >
          Confirm {selected.length > 0 ? `(${selected.length})` : ''}
        </Button>
      )}
      {resolved && (
        <div className="mt-0.5 flex items-center gap-1.5">
          <span className="size-1.5 rounded-full bg-success" />
          <span className="text-[11px] font-medium text-success">You picked: {answer}</span>
        </div>
      )}
    </div>
  )
}

function RemoteCard({ message: m }: { message: Message }) {
  const remote = m.remote!
  const [status, setStatus] = useState<'stuck' | 'you' | 'retrying'>(
    remote.status === 'stuck' ? 'stuck' : 'you',
  )

  return (
    <CardShell>
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <span
          className={cn(
            'size-1.5 shrink-0 rounded-full',
            status === 'stuck' ? 'bg-warning' : 'bg-success',
          )}
        />
        <div className="min-w-0 flex-1 text-xs font-semibold">
          Remote machine · {remote.machine}
        </div>
        <div
          className={cn(
            'text-[10px] font-medium',
            status === 'stuck' ? 'text-warning' : 'text-success',
          )}
        >
          {status === 'stuck' ? 'Needs a human' : status === 'you' ? 'You have control' : 'Retrying'}
        </div>
      </div>
      <div className="bg-background/70">
        <div className="flex items-center gap-2 border-b bg-card/70 px-2.5 py-1.5">
          <span className="flex gap-1">
            <span className="size-1.5 rounded-full bg-muted-foreground/30" />
            <span className="size-1.5 rounded-full bg-muted-foreground/30" />
            <span className="size-1.5 rounded-full bg-muted-foreground/30" />
          </span>
          <span className="min-w-0 flex-1 truncate rounded bg-background/70 px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
            {remote.url}
          </span>
        </div>
        <div className="flex h-28 items-center justify-center bg-[repeating-linear-gradient(115deg,transparent_0_9px,oklch(1_0_0/3%)_9px_18px)]">
          <div className="max-w-[78%] rounded-md border bg-popover px-3.5 py-2.5 shadow-lg">
            <div className="mb-1.5 text-[11px] font-semibold">{remote.blocker}</div>
            <div className="flex items-center gap-1.5">
              <span className="size-3 rounded-xs border border-muted-foreground/50" />
              <span className="text-[10px] text-muted-foreground">I'm not a robot</span>
            </div>
          </div>
        </div>
      </div>
      {status === 'stuck' ? (
        <div className="flex gap-2 border-t px-3 py-2">
          <Button size="xs" onClick={() => setStatus('you')}>
            Take control
          </Button>
          <Button size="xs" variant="outline" onClick={() => setStatus('retrying')}>
            Retry without me
          </Button>
        </div>
      ) : (
        <StatusLine
          ok
          label={status === 'you' ? 'You took control — bot is paused' : 'Retrying without you'}
        />
      )}
    </CardShell>
  )
}
