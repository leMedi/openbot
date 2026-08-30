import { useState } from 'react'
import { SmilePlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { MORE_EMOJI, QUICK_EMOJI } from './data'
import type { Reaction } from './types'

/**
 * Reaction pills. First-seen emoji order is preserved by the entry state;
 * user toggles apply optimistically via onToggle.
 */
export function ReactionPills({
  reactions,
  onToggle,
}: {
  reactions: Reaction[]
  onToggle: (emoji: string) => void
}) {
  if (reactions.length === 0) return null
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1">
      {reactions.map((r) => {
        const mine = r.users.includes('You')
        const label = mine ? `Remove ${r.emoji} reaction` : `React with ${r.emoji}`
        return (
          <Tooltip key={r.emoji}>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  aria-pressed={mine}
                  aria-label={label}
                  onClick={() => onToggle(r.emoji)}
                  className={cn(
                    'flex h-6 items-center gap-1 rounded-full border px-2 text-xs',
                    mine
                      ? 'border-primary/60 bg-primary/15'
                      : 'bg-card/60 hover:border-foreground/25',
                  )}
                >
                  <span>{r.emoji}</span>
                  {r.users.length > 1 && (
                    <span className="text-[10px] font-semibold tabular-nums text-muted-foreground">
                      {r.users.length}
                    </span>
                  )}
                </button>
              }
            />
            <TooltipContent side="top">{r.users.join(', ')}</TooltipContent>
          </Tooltip>
        )
      })}
    </div>
  )
}

/** Quick emoji row plus a `More emoji` grid. Optionally controlled via open/onOpenChange. */
export function ReactionPicker({
  onPick,
  render,
  open: openProp,
  onOpenChange,
}: {
  onPick: (emoji: string) => void
  render?: React.ReactElement
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const [internalOpen, setInternalOpen] = useState(false)
  const [more, setMore] = useState(false)
  const open = openProp ?? internalOpen

  function setOpen(v: boolean) {
    onOpenChange?.(v)
    if (openProp === undefined) setInternalOpen(v)
  }

  function pick(emoji: string) {
    onPick(emoji)
    setOpen(false)
    setMore(false)
  }

  return (
    <Popover
      open={open}
      onOpenChange={(v) => {
        setOpen(v)
        if (!v) setMore(false)
      }}
    >
      <PopoverTrigger
        render={
          render ?? (
            <Button variant="ghost" size="icon-sm" aria-label="Add reaction">
              <SmilePlus className="size-3.5" />
            </Button>
          )
        }
      />
      <PopoverContent align="start" className="w-auto p-1.5">
        <div className="flex items-center gap-0.5">
          {QUICK_EMOJI.map((e) => (
            <button
              key={e}
              type="button"
              aria-label={`React with ${e}`}
              onClick={() => pick(e)}
              className="flex size-7.5 items-center justify-center rounded-md text-base hover:bg-muted"
            >
              {e}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setMore((v) => !v)}
            className="ml-0.5 rounded-md px-1.5 py-1 text-[11px] font-medium text-info hover:bg-muted"
          >
            More emoji
          </button>
        </div>
        {more && (
          <div className="mt-1.5 grid grid-cols-10 gap-0.5 border-t pt-1.5">
            {MORE_EMOJI.map((e) => (
              <button
                key={e}
                type="button"
                aria-label={`React with ${e}`}
                onClick={() => pick(e)}
                className="flex size-7 items-center justify-center rounded-md text-sm hover:bg-muted"
              >
                {e}
              </button>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
