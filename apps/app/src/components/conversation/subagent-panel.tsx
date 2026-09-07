import { useCallback, useEffect, useState } from 'react'
import { Bot, MessageSquareMore, RefreshCw, Square } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Textarea } from '@/components/ui/textarea'
import type { SubagentView } from './types'

type SubagentPanelProps = {
  load: () => Promise<SubagentView[]>
  steer: (subagentId: string, message: string) => Promise<unknown>
  stop: (subagentId: string) => Promise<unknown>
}

function elapsed(worker: SubagentView) {
  if (worker.elapsedMs == null) return 'Queued'
  const seconds = Math.floor(worker.elapsedMs / 1_000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  return minutes < 60 ? `${minutes}m ${seconds % 60}s` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

export function SubagentPanel({ load, steer, stop }: SubagentPanelProps) {
  const [open, setOpen] = useState(false)
  const [workers, setWorkers] = useState<SubagentView[]>([])
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')

  const refresh = useCallback(async () => {
    try {
      setWorkers(await load())
      setError('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load workers')
    }
  }, [load])

  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => void refresh(), 2_000)
    return () => window.clearInterval(timer)
  }, [refresh])

  async function sendSteer(worker: SubagentView) {
    const message = drafts[worker.id]?.trim()
    if (!message) return
    setBusy(worker.id)
    try {
      await steer(worker.id, message)
      setDrafts((current) => ({ ...current, [worker.id]: '' }))
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not steer worker')
    } finally {
      setBusy(null)
    }
  }

  async function stopWorker(worker: SubagentView) {
    setBusy(worker.id)
    try {
      await stop(worker.id)
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not stop worker')
    } finally {
      setBusy(null)
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            aria-label="Manage workers"
            title="Manage workers"
            className="relative text-muted-foreground"
          >
            <Bot className="size-3.5" />
            <span className="hidden sm:inline">Workers</span>
            {workers.length > 0 && (
              <span className="flex size-4 items-center justify-center rounded-full bg-warning/20 text-[9px] font-bold text-warning">
                {workers.length}
              </span>
            )}
          </Button>
        }
      />
      <PopoverContent align="end" className="max-h-[70vh] w-[min(26rem,calc(100vw-1rem))] overflow-y-auto p-0">
        <PopoverHeader className="flex-row items-center border-b px-3 py-2.5">
          <div className="min-w-0 flex-1">
            <PopoverTitle>Background workers</PopoverTitle>
            <p className="text-[11px] text-muted-foreground">Steer or stop temporary subagents.</p>
          </div>
          <Button variant="ghost" size="icon-xs" aria-label="Refresh workers" onClick={() => void refresh()}>
            <RefreshCw className="size-3" />
          </Button>
        </PopoverHeader>

        <div className="flex flex-col gap-2 p-2.5">
          {error && <p className="rounded-md bg-destructive/10 px-2 py-1.5 text-xs text-destructive">{error}</p>}
          {workers.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">No active workers.</p>
          ) : workers.map((worker) => (
            <section key={worker.id} className="rounded-lg border bg-card/50 p-2.5">
              <div className="flex items-start gap-2">
                <span className={worker.status === 'running'
                  ? 'mt-1 size-1.5 shrink-0 animate-pulse rounded-full bg-warning'
                  : 'mt-1 size-1.5 shrink-0 rounded-full bg-muted-foreground/50'} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-semibold">{worker.title}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <Badge variant="outline" className="h-4 px-1.5 text-[9px]">{worker.type}</Badge>
                    <Badge
                      variant={worker.status === 'waiting' ? 'warning' : 'secondary'}
                      className="h-4 px-1.5 text-[9px]"
                    >
                      {worker.status}
                    </Badge>
                    <span className="text-[10px] text-muted-foreground">{elapsed(worker)}</span>
                    <span className="text-[10px] text-muted-foreground">{worker.toolCallCount} tool calls</span>
                  </div>
                </div>
                <Button
                  variant="destructive-outline"
                  size="icon-xs"
                  aria-label={`Stop ${worker.title}`}
                  disabled={busy === worker.id}
                  onClick={() => void stopWorker(worker)}
                >
                  <Square className="size-2.5" />
                </Button>
              </div>

              {worker.recentActivity.length > 0 && (
                <div className="mt-2 rounded-md bg-muted/50 px-2 py-1.5 font-mono text-[10px] leading-relaxed text-muted-foreground">
                  {worker.recentActivity.map((activity, index) => (
                    <div key={`${index}:${activity}`} className="truncate">{activity}</div>
                  ))}
                </div>
              )}

              <div className="mt-2 flex items-end gap-1.5">
                <Textarea
                  value={drafts[worker.id] ?? ''}
                  onChange={(event) =>
                    setDrafts((current) => ({ ...current, [worker.id]: event.target.value }))
                  }
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault()
                      void sendSteer(worker)
                    }
                  }}
                  placeholder="Send updated guidance…"
                  aria-label={`Guidance for ${worker.title}`}
                  className="min-h-8 resize-none py-1.5 text-xs"
                />
                <Button
                  size="icon-sm"
                  aria-label={`Send guidance to ${worker.title}`}
                  disabled={busy === worker.id || !drafts[worker.id]?.trim()}
                  onClick={() => void sendSteer(worker)}
                >
                  <MessageSquareMore className="size-3.5" />
                </Button>
              </div>
            </section>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
