// Inline action card for SendMessage widgets: stacked option rows the user
// picks from directly in the transcript, plus the plugin-connect variant for
// enable-plugin asks. Non-interactive renders show the resolved answer.

import { useState } from 'react'
import { MCP_CATALOG } from '@openbot/plugins/mcp-catalog'
import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { WidgetOption, WidgetResponse, WidgetView } from './types'

export function ActionCard({
  widget,
  interactive,
  onRespond,
  onOpenDesktop,
}: {
  widget: WidgetView
  /** Only the widget of the currently suspended turn accepts input. */
  interactive?: boolean
  onRespond?: (response: WidgetResponse) => void
  onOpenDesktop?: () => void
}) {
  if (widget.plugin) {
    return <PluginConnectCard widget={widget} interactive={interactive} onRespond={onRespond} />
  }
  if (widget.kind === 'handoff') {
    return (
      <DesktopHandoffCard
        widget={widget}
        interactive={interactive}
        onRespond={onRespond}
        onOpenDesktop={onOpenDesktop}
      />
    )
  }
  return <ChoiceCard widget={widget} interactive={interactive} onRespond={onRespond} />
}

function DesktopHandoffCard({
  widget,
  interactive,
  onRespond,
  onOpenDesktop,
}: {
  widget: WidgetView
  interactive?: boolean
  onRespond?: (response: WidgetResponse) => void
  onOpenDesktop?: () => void
}) {
  const pending = widget.status === 'pending'
  const active = pending && !!interactive
  if (!pending) {
    return (
      <p className="text-[11px] font-medium text-muted-foreground">
        {widget.response?.optionId === 'hand_back' ? 'Desktop handed back' : 'Desktop step skipped'}
      </p>
    )
  }
  return (
    <div className="flex min-w-64 flex-col gap-2">
      {widget.helpText && <p className="text-[11px] text-muted-foreground">{widget.helpText}</p>}
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={!active || !onOpenDesktop}
          onClick={onOpenDesktop}
          className="rounded-md bg-primary px-3.5 py-1.5 text-[11.5px] font-semibold text-white disabled:opacity-50"
        >
          Open Remote Desktop
        </button>
        <button
          type="button"
          disabled={!active || !onRespond}
          onClick={() => onRespond?.({ optionId: 'skip', text: 'Skip', dismissed: false })}
          className="px-1.5 py-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground disabled:opacity-50"
        >
          Skip
        </button>
      </div>
    </div>
  )
}

function ChoiceCard({
  widget,
  interactive,
  onRespond,
}: {
  widget: WidgetView
  interactive?: boolean
  onRespond?: (response: WidgetResponse) => void
}) {
  const [custom, setCustom] = useState('')
  const pending = widget.status === 'pending'
  const active = pending && !!interactive && !!onRespond
  const dismissed = widget.status === 'dismissed'
  const selectedId = widget.response?.optionId ?? null
  const selectedOption = widget.options.find((option) => option.id === selectedId)
  const visibleOptions = widget.status === 'resolved'
    ? selectedOption ? [selectedOption] : []
    : widget.options

  const pick = (option: WidgetOption) =>
    onRespond?.({ optionId: option.id, text: option.label, dismissed: false })
  const submitCustom = () => {
    const text = custom.trim()
    if (!text) return
    setCustom('')
    onRespond?.({ optionId: null, text, dismissed: false })
  }

  return (
    <div className="flex w-full min-w-56 flex-col gap-1.5">
      {pending && widget.helpText && (
        <p className={cn('text-[11px] text-muted-foreground', !pending && 'opacity-55')}>
          {widget.helpText}
        </p>
      )}
      {visibleOptions.map((option) => {
        const selected = selectedId === option.id
        const style = pending ? option.style : undefined
        return (
          <button
            key={option.id}
            type="button"
            disabled={!active}
            onClick={() => pick(option)}
            className={cn(
              'flex w-full items-center gap-2.5 rounded-lg border bg-card px-3 py-2 text-left',
              style === 'primary' && 'border-primary/45 bg-primary/20',
              style === 'danger' && 'border-destructive/40 bg-destructive/10',
              selected && 'border-primary/65 bg-primary/15',
              (dismissed || (widget.status === 'resolved' && !selected)) && 'opacity-45',
              active
                ? style === 'danger'
                  ? 'hover:border-destructive/70'
                  : 'hover:border-foreground/30'
                : 'cursor-default',
            )}
          >
            <span
              className={cn(
                'flex size-[15px] shrink-0 items-center justify-center rounded-full border-[1.5px]',
                selected ? 'border-primary bg-primary' : 'border-muted-foreground/60',
              )}
            >
              {selected && <Check className="size-2.5 text-white" strokeWidth={3.5} />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[12.5px] font-medium">{option.label}</span>
              {option.description && (
                <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">
                  {option.description}
                </span>
              )}
            </span>
          </button>
        )
      })}
      {widget.status === 'resolved' && widget.response && !selectedOption && (
        <div className="flex w-full items-center gap-2.5 rounded-lg border border-primary/65 bg-primary/15 px-3 py-2 text-left">
          <span className="flex size-[15px] shrink-0 items-center justify-center rounded-full border-[1.5px] border-primary bg-primary">
            <Check className="size-2.5 text-white" strokeWidth={3.5} />
          </span>
          <span className="min-w-0 flex-1 text-[12.5px] font-medium whitespace-pre-wrap">
            {widget.response.text}
          </span>
        </div>
      )}
      {active && widget.allowCustom && (
        <div className="flex gap-1.5">
          <input
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submitCustom()}
            placeholder="Or type your own…"
            className="min-w-0 flex-1 rounded-lg border bg-card px-3 py-2 text-[12.5px] outline-none focus:border-primary/60"
          />
          <button
            type="button"
            onClick={submitCustom}
            className={cn(
              'shrink-0 rounded-lg px-3.5 text-[11.5px] font-semibold',
              custom.trim()
                ? 'bg-primary text-white hover:opacity-90'
                : 'bg-muted text-muted-foreground/60',
            )}
          >
            Send
          </button>
        </div>
      )}
      {active && widget.kind !== 'approval' && (
        <div className="mt-0.5 flex items-center gap-3">
          <button
            type="button"
            onClick={() => onRespond?.({ optionId: null, text: 'Question dismissed.', dismissed: true })}
            className="text-[11px] font-medium text-muted-foreground hover:text-foreground"
          >
            Dismiss
          </button>
          {widget.dismissOnMoveOn && (
            <span className="text-[10.5px] text-muted-foreground/60 italic">
              Expires if you move on
            </span>
          )}
        </div>
      )}
      <Dismissal widget={widget} />
    </div>
  )
}

/** Muted resolution line for dismissed widgets. */
function Dismissal({ widget }: { widget: WidgetView }) {
  if (widget.status === 'dismissed') {
    return (
      <div className="mt-0.5 text-[11px] font-medium text-muted-foreground">
        {widget.dismissReason === 'moveOn' ? 'Expired — you moved on' : 'Dismissed'}
      </div>
    )
  }
  return null
}

/** Enable-plugin ask: plugin identity row with a Connect action. */
function PluginConnectCard({
  widget,
  interactive,
  onRespond,
}: {
  widget: WidgetView
  interactive?: boolean
  onRespond?: (response: WidgetResponse) => void
}) {
  const plugin = widget.plugin!
  const entry = MCP_CATALOG.find((candidate) => candidate.key === plugin.key)
  const active = widget.status === 'pending' && !!interactive && !!onRespond
  const connect = widget.options.find((option) => option.id === 'approve') ?? widget.options[0]
  const decline = widget.options.find((option) => option.id === 'deny')
  const connected = widget.status === 'resolved' && widget.response?.optionId === connect?.id

  return (
    <div className="flex w-full min-w-64 items-center gap-2.5 rounded-lg border bg-card px-3 py-2.5">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-lg border bg-muted/40">
        {entry ? (
          <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
            <path d={entry.icon.path} fill={entry.icon.color} />
          </svg>
        ) : (
          <span className="text-[11px] font-semibold text-muted-foreground">
            {plugin.name.slice(0, 1).toUpperCase()}
          </span>
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12.5px] font-semibold">{plugin.name}</span>
        <span className="block truncate text-[11px] text-muted-foreground">
          {entry ? entry.description : 'Plugin'}
        </span>
      </span>
      {active && connect ? (
        <span className="flex shrink-0 items-center gap-1.5">
          {decline && (
            <button
              type="button"
              onClick={() =>
                onRespond?.({ optionId: decline.id, text: 'User skipped.', dismissed: false })
              }
              className="px-1.5 py-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground"
            >
              {decline.label}
            </button>
          )}
          <button
            type="button"
            onClick={() =>
              onRespond?.({ optionId: connect.id, text: connect.label, dismissed: false })
            }
            className="rounded-md bg-primary px-3.5 py-1.5 text-[11.5px] font-semibold text-white hover:opacity-90"
          >
            {connect.label}
          </button>
        </span>
      ) : widget.status === 'pending' ? (
        <span className="shrink-0 text-[11px] font-medium text-muted-foreground">Pending</span>
      ) : (
        <span className="flex shrink-0 items-center gap-1.5">
          <span
            className={cn(
              'size-1.5 rounded-full',
              connected ? 'bg-success' : 'bg-muted-foreground/60',
            )}
          />
          <span
            className={cn(
              'text-[11px] font-medium',
              connected ? 'text-success' : 'text-muted-foreground',
            )}
          >
            {connected ? 'Connected' : 'Skipped'}
          </span>
        </span>
      )}
    </div>
  )
}
