import { useEffect, useRef, useState } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import {
  Ban,
  Bot,
  Brain,
  Check,
  ChevronRight,
  MessageSquare,
  User,
  X,
  XCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { ToolStatusIcon } from './tool-rows'
import type { ActivityItem, ActivityTab } from './types'

function TabMarker({ status }: { status?: ActivityTab['status'] }) {
  switch (status) {
    case 'running':
      return <span className="size-1.5 animate-pulse rounded-full bg-warning" />
    case 'done':
      return <Check className="size-3 text-success" />
    case 'error':
      return <XCircle className="size-3 text-destructive" />
    case 'aborted':
      return <Ban className="size-3 text-muted-foreground" />
    default:
      return null
  }
}

function itemIcon(item: ActivityItem) {
  switch (item.kind) {
    case 'you':
      return <User className="size-3 text-info" />
    case 'thinking':
      return <Brain className="size-3 text-muted-foreground" />
    case 'agent':
      return <Bot className="size-3 text-success" />
    case 'message':
      return <MessageSquare className="size-3 text-muted-foreground" />
    case 'tool':
      return <ToolStatusIcon status={item.toolStatus ?? 'success'} className="size-3" />
  }
}

function ActivityRow({ item }: { item: ActivityItem }) {
  const [expanded, setExpanded] = useState(false)
  const collapsible = !!item.summary || item.text.length > 120
  const shown = expanded
    ? item.text
    : (item.summary ?? (item.text.length > 120 ? `${item.text.slice(0, 120)}…` : item.text))

  return (
    <button
      type="button"
      onClick={() => collapsible && setExpanded((v) => !v)}
      className={cn(
        'flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left',
        collapsible && 'hover:bg-muted/50',
      )}
    >
      <span className="mt-0.5 flex w-14 shrink-0 items-center gap-1.5">
        {itemIcon(item)}
        <span className="text-[9px] font-semibold tracking-wider text-muted-foreground/70 uppercase">
          {item.kind}
        </span>
      </span>
      <span
        className={cn(
          'min-w-0 flex-1 text-xs leading-relaxed',
          item.kind === 'thinking' && 'text-muted-foreground italic',
          item.kind === 'tool' && 'font-mono text-[11px] text-muted-foreground',
        )}
      >
        {item.toolName && (
          <span className="mr-1.5 font-sans font-semibold text-foreground">{item.toolName}</span>
        )}
        {shown}
      </span>
      {collapsible && (
        <ChevronRight
          className={cn(
            'mt-0.5 size-3 shrink-0 text-muted-foreground/50 transition-transform',
            expanded && 'rotate-90',
          )}
        />
      )}
    </button>
  )
}

/** Movable dialog: `Full conversation: <agent>`. Escape closes; header drags. */
export function FullConversationDialog({
  agentName,
  tabs: initialTabs,
  onClose,
}: {
  agentName: string
  tabs: ActivityTab[]
  onClose: () => void
}) {
  const [tabs, setTabs] = useState(initialTabs)
  const [activeId, setActiveId] = useState(initialTabs[0]?.id ?? 'root')
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const drag = useRef<{ startX: number; startY: number; baseX: number; baseY: number } | null>(
    null,
  )
  const scrollRef = useRef<HTMLDivElement>(null)

  useHotkeys('escape', onClose, { enableOnFormTags: true, enableOnContentEditable: true })

  // Running subagent data refreshes every two seconds (mocked ticks);
  // activity follows appended entries.
  useEffect(() => {
    const t = setInterval(() => {
      setTabs((all) =>
        all.map((tab) =>
          tab.status === 'running'
            ? {
                ...tab,
                items: [
                  ...tab.items,
                  {
                    kind: 'tool',
                    text: `poll_status() — batch ${tab.items.length + 1} still processing`,
                    toolName: 'fetch_orders',
                    toolStatus: 'pending',
                  },
                ],
              }
            : tab,
        ),
      )
    }, 2000)
    return () => clearInterval(t)
  }, [])

  const active = tabs.find((t) => t.id === activeId) ?? tabs[0]

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [active?.items.length, activeId])

  function onDragStart(e: React.PointerEvent) {
    drag.current = { startX: e.clientX, startY: e.clientY, baseX: pos.x, baseY: pos.y }
    const onMove = (ev: PointerEvent) => {
      if (!drag.current) return
      setPos({
        x: drag.current.baseX + ev.clientX - drag.current.startX,
        y: drag.current.baseY + ev.clientY - drag.current.startY,
      })
    }
    const onUp = () => {
      drag.current = null
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  return (
    <div
      role="dialog"
      aria-label={`Full conversation: ${agentName}`}
      className="fixed top-16 left-1/2 z-50 flex h-[70vh] w-[min(44rem,90vw)] -translate-x-1/2 flex-col overflow-hidden rounded-xl border bg-popover shadow-2xl"
      style={{ transform: `translate(calc(-50% + ${pos.x}px), ${pos.y}px)` }}
    >
      <div
        onPointerDown={onDragStart}
        className="flex h-10 shrink-0 cursor-grab items-center gap-2.5 border-b bg-card/60 px-3 select-none active:cursor-grabbing"
      >
        <span className="flex-1 truncate text-xs font-semibold">
          Full conversation: {agentName}
        </span>
        <Button variant="ghost" size="icon-xs" aria-label="Close" onClick={onClose}>
          <X />
        </Button>
      </div>

      <div className="flex shrink-0 gap-1 overflow-x-auto border-b px-2 py-1.5">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveId(tab.id)}
            className={cn(
              'flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium',
              tab.id === active?.id
                ? 'bg-muted text-foreground'
                : 'text-muted-foreground hover:bg-muted/50',
            )}
          >
            <span className="max-w-48 truncate">
              {tab.subagentType
                ? `${tab.subagentType}: ${tab.title}`
                : tab.title || 'Conversation'}
            </span>
            <TabMarker status={tab.status} />
          </button>
        ))}
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto p-2">
        {!active || active.items.length === 0 ? (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            No conversation activity yet.
          </div>
        ) : (
          <div className="flex flex-col gap-0.5">
            {active.items.map((item, i) => (
              <ActivityRow key={i} item={item} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
