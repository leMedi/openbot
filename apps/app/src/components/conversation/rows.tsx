import { useState } from 'react'
import {
  Brain,
  ChevronRight,
  Copy,
  CornerUpLeft,
  FileText,
  MessageSquarePlus,
  MoreHorizontal,
  RotateCcw,
  SmilePlus,
  Trash2,
  Zap,
} from 'lucide-react'
import { BotAvatar } from '@/components/openbot/bot-avatar'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { AgentMarkdown } from './agent-markdown'
import { SendMessageCard } from './cards'
import { ReactionPicker, ReactionPills } from './reactions'
import { ToolCallRow } from './tool-rows'
import type {
  Author,
  Entry,
  MessageEntry,
  ThinkingEntry,
  TimelineEntry,
  ToolEntry,
} from './types'

export function TypingDots() {
  return (
    <div className="flex w-fit items-center gap-1 rounded-xl bg-card px-3.5 py-3">
      <span className="size-1.5 animate-typing-dot rounded-full bg-muted-foreground" />
      <span className="size-1.5 animate-typing-dot rounded-full bg-muted-foreground [animation-delay:.15s]" />
      <span className="size-1.5 animate-typing-dot rounded-full bg-muted-foreground [animation-delay:.3s]" />
    </div>
  )
}

/** Group avatar composed from member avatars with `+N` overflow. */
export function GroupAvatar({ members, className }: { members: Author[]; className?: string }) {
  const shown = members.slice(0, 3)
  const extra = members.length - shown.length
  return (
    <div className={cn('flex items-center', className)}>
      {shown.map((m, i) => (
        <BotAvatar
          key={m.id}
          name={m.name}
          color={m.color}
          shape={m.shape}
          src={m.avatarUrl}
          className={cn('size-5 rounded-sm text-[8px]', i > 0 && '-ml-1.5 border border-panel')}
        />
      ))}
      {extra > 0 && (
        <span className="-ml-1.5 flex size-5 items-center justify-center rounded-sm border border-panel bg-muted text-[8px] font-semibold text-muted-foreground">
          +{extra}
        </span>
      )}
    </div>
  )
}

export function TimelineRow({ entry }: { entry: TimelineEntry }) {
  return (
    <div className="flex items-center justify-center gap-1.5 py-1.5 text-[11px] text-muted-foreground/80">
      {entry.icon === 'automation' && <Zap className="size-3 text-success" />}
      <span>{entry.text}</span>
      {entry.time && <span className="text-muted-foreground/50">· {entry.time}</span>}
    </div>
  )
}

export function ThinkingRow({ entry }: { entry: ThinkingEntry }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="py-0.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground"
      >
        <Brain className="size-3" />
        Thought{entry.duration ? ` for ${entry.duration}` : ''}
        <ChevronRight className={cn('size-3 transition-transform', open && 'rotate-90')} />
      </button>
      {open && (
        <p className="mt-1 max-w-xl border-l-2 border-border pl-2.5 text-xs leading-relaxed text-muted-foreground italic">
          {entry.text}
        </p>
      )}
    </div>
  )
}

export function ToolEntryRow({ entry }: { entry: ToolEntry }) {
  return (
    <div className="py-0.5">
      <ToolCallRow call={entry.call} result={entry.result} />
    </div>
  )
}

export type MessageRowHandlers = {
  onToggleReaction: (id: string, emoji: string) => void
  onReply: (id: string) => void
  onStartThread: (id: string) => void
  onOpenThread: (id: string) => void
  onJump: (id: string) => void
  onResend: (id: string) => void
  onDelete: (id: string) => void
  onCancelSend: (id: string) => void
  findEntry: (id: string) => Entry | undefined
}

export function MessageRow({
  entry,
  groupStart,
  inThread,
  oneToOne,
  readOnly,
  handlers,
}: {
  entry: MessageEntry
  groupStart: boolean
  inThread?: boolean
  /** 1-to-1 conversations render no avatars or author headers. */
  oneToOne?: boolean
  /** Read-only conversations expose no message actions. */
  readOnly?: boolean
  handlers: MessageRowHandlers
}) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const isUser = entry.author.kind === 'user'
  const delivery = entry.delivery ?? 'delivered'
  const pending = delivery !== 'delivered'
  // Copy applies to ordinary text only — not bare URLs, attachment paths,
  // or structured cards.
  const ordinaryText = (entry.text ?? entry.markdown ?? '').trim()
  const copyable =
    !!ordinaryText &&
    !/^https?:\/\/\S+$/.test(ordinaryText) &&
    !(entry.cards && entry.cards.length > 0)
  const streamingEmpty = delivery === 'streaming' && !entry.text && !entry.markdown
  const showIdentity = !oneToOne && !isUser
  const showThreadAction = !inThread // thread actions are unavailable inside a thread
  const showMoreMenu = showThreadAction || copyable

  return (
    <div
      id={`entry-${entry.id}`}
      data-group-start={groupStart || undefined}
      role="group"
      aria-label={`${entry.author.name}, ${entry.time}`}
      tabIndex={-1}
      className={cn(
        'group flex animate-rise gap-2.5 rounded-lg px-1 py-1 transition-colors',
        isUser ? 'justify-end' : 'justify-start',
        groupStart && 'mt-2',
        // Reaction pills hang below the card edge; keep the next row clear.
        entry.reactions && entry.reactions.length > 0 && 'mb-3',
      )}
    >
      {showIdentity && (
        <div className="w-6.5 shrink-0 pt-0.5">
          {groupStart && (
            <BotAvatar
              name={entry.author.name}
              color={entry.author.color}
              shape={entry.author.shape}
              src={entry.author.avatarUrl}
              className="size-6.5 text-[10px]"
            />
          )}
        </div>
      )}

      <div
        className={cn(
          'relative flex max-w-[68%] min-w-0 flex-col gap-1',
          isUser ? 'items-end' : 'items-start',
        )}
      >
        {showIdentity && groupStart && (
          <div className="flex items-baseline gap-2">
            <span className="text-[13px] font-semibold">{entry.author.name}</span>
            <span className="text-[10px] text-muted-foreground/70">{entry.time}</span>
          </div>
        )}

        {entry.replyTo && (
          <ReplyQuote target={handlers.findEntry(entry.replyTo)} onJump={handlers.onJump} />
        )}

        {streamingEmpty ? (
          <TypingDots />
        ) : (
          (entry.text || entry.markdown) && (
            <div
              className={cn(
                'w-fit max-w-full rounded-xl px-3.5 py-2.5',
                isUser ? 'bg-primary text-white' : 'bg-card',
              )}
            >
              {entry.text && (
                <p className="text-sm leading-relaxed whitespace-pre-wrap">{entry.text}</p>
              )}
              {entry.markdown && (
                <AgentMarkdown
                  markdown={entry.markdown}
                  images={entry.images}
                  channel={entry.channel}
                />
              )}
            </div>
          )
        )}

        {entry.attachments && entry.attachments.length > 0 && (
          <div className={cn('flex flex-wrap gap-1.5', isUser && 'justify-end')}>
            {entry.attachments.map((a) => {
              const tile =
                a.kind === 'image' ? (
                  <div className="flex h-24 w-36 items-end rounded-lg border bg-[repeating-linear-gradient(115deg,transparent_0_9px,oklch(1_0_0/4%)_9px_18px)] p-1.5">
                    <span className="max-w-full truncate rounded bg-black/55 px-1.5 py-0.5 text-[9px] text-muted-foreground">
                      {a.name}
                    </span>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 rounded-lg border bg-card/60 px-2.5 py-1.5">
                    <FileText className="size-3 text-muted-foreground" />
                    <span className="text-[11px] font-medium">{a.name}</span>
                    {a.size && (
                      <span className="text-[10px] text-muted-foreground/70">{a.size}</span>
                    )}
                  </div>
                )
              return a.url ? (
                <a key={a.id} href={a.url} download={a.name} className="hover:opacity-80">
                  {tile}
                </a>
              ) : (
                <div key={a.id}>{tile}</div>
              )
            })}
          </div>
        )}

        {entry.cards && entry.cards.length > 0 && (
          <div className={cn('flex flex-col gap-1.5', isUser ? 'items-end' : 'items-start')}>
            {entry.cards.map((card, i) => (
              <SendMessageCard key={i} card={card} />
            ))}
          </div>
        )}

        {entry.reactions && entry.reactions.length > 0 && (
          <ReactionPills
            reactions={entry.reactions}
            onToggle={(emoji) => handlers.onToggleReaction(entry.id, emoji)}
            className={cn('absolute -bottom-3 z-10', isUser ? 'right-1.5' : 'left-1.5')}
          />
        )}

        {!inThread && entry.thread && (
          <button
            type="button"
            onClick={() => handlers.onOpenThread(entry.id)}
            className="flex items-center gap-1 text-[11px] font-semibold text-info hover:opacity-80"
          >
            <MessageSquarePlus className="size-3" />
            {entry.thread.length === 0
              ? 'View thread'
              : entry.thread.length === 1
                ? '1 reply'
                : `${entry.thread.length} replies`}
            <ChevronRight className="size-3" />
          </button>
        )}

        {delivery === 'queued' && (
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            Waiting to send…
            <button
              type="button"
              onClick={() => handlers.onCancelSend(entry.id)}
              className="font-medium text-info hover:opacity-80"
            >
              Cancel
            </button>
          </div>
        )}
        {delivery === 'offline-queued' && (
          <div className="text-[11px] text-muted-foreground">Will send when reconnected</div>
        )}
        {delivery === 'failed' && (
          <div className="flex items-center gap-2 text-[11px] text-destructive">
            Failed to send
            <button
              type="button"
              onClick={() => handlers.onResend(entry.id)}
              className="flex items-center gap-0.5 font-medium text-info hover:opacity-80"
            >
              <RotateCcw className="size-2.5" /> Resend
            </button>
            <button
              type="button"
              onClick={() => handlers.onDelete(entry.id)}
              className="flex items-center gap-0.5 font-medium text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="size-2.5" /> Delete
            </button>
          </div>
        )}

        {/* Hover/focus action toolbar — authoritative delivered messages only,
            hidden in read-only conversations. Borderless ghost buttons inside
            one bordered container; kept mounted while the picker or menu is
            open so their popups keep an anchored position. */}
        {!pending && !readOnly && (
          <div
            role="toolbar"
            aria-label={`Message actions for ${entry.author.name} (${entry.id})`}
            className={cn(
              'absolute top-0 z-10 items-center gap-0.5 rounded-lg border bg-popover px-1 py-0.5 shadow-lg',
              isUser ? 'right-full mr-1.5' : 'left-full ml-1.5',
              'hidden group-focus-within:flex group-hover:flex',
              (pickerOpen || menuOpen) && 'flex',
            )}
          >
            <ReactionPicker
              open={pickerOpen}
              onOpenChange={setPickerOpen}
              onPick={(emoji) => handlers.onToggleReaction(entry.id, emoji)}
              render={
                <Button variant="ghost" size="icon-xs" className="border-none" aria-label="Add reaction">
                  <SmilePlus />
                </Button>
              }
            />
            <Button
              variant="ghost"
              size="icon-xs"
              className="border-none"
              aria-label={
                isUser ? 'Reply to your message' : `Reply to ${entry.author.name} message`
              }
              onClick={() => handlers.onReply(entry.id)}
            >
              <CornerUpLeft />
            </Button>
            {showMoreMenu && (
              <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      className="border-none"
                      aria-label="More message actions"
                    >
                      <MoreHorizontal />
                    </Button>
                  }
                />
                <DropdownMenuContent align={isUser ? 'end' : 'start'} className="w-44">
                  {showThreadAction && (
                    <DropdownMenuItem
                      onClick={() =>
                        entry.thread
                          ? handlers.onOpenThread(entry.id)
                          : handlers.onStartThread(entry.id)
                      }
                    >
                      <MessageSquarePlus />
                      {entry.thread ? 'Open thread' : 'Start a thread'}
                    </DropdownMenuItem>
                  )}
                  {copyable && (
                    <DropdownMenuItem
                      onClick={() => navigator.clipboard?.writeText(ordinaryText)}
                    >
                      <Copy /> Copy
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function ReplyQuote({
  target,
  onJump,
}: {
  target: Entry | undefined
  onJump: (id: string) => void
}) {
  if (!target || target.type !== 'message') {
    return (
      <div className="flex w-fit items-center gap-1.5 rounded-md bg-muted/60 px-2 py-1 text-[11px] text-muted-foreground italic">
        <CornerUpLeft className="size-2.5" />
        (deleted)
      </div>
    )
  }
  const preview =
    target.text ??
    target.markdown?.split('\n')[0] ??
    (target.attachments?.length ? target.attachments[0].name : '…')
  return (
    <button
      type="button"
      onClick={() => onJump(target.id)}
      className="flex w-fit max-w-sm items-center gap-1.5 rounded-md bg-muted/60 px-2 py-1 text-left hover:bg-muted"
    >
      <span
        className="h-3.5 w-0.5 shrink-0 rounded-full"
        style={{ background: target.author.color }}
      />
      <span className="shrink-0 text-[11px] font-semibold" style={{ color: target.author.color }}>
        {target.author.name}
      </span>
      <span className="truncate text-[11px] text-muted-foreground">{preview}</span>
    </button>
  )
}
