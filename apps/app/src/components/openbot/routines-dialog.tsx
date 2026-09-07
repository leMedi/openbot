import { useEffect, useState } from 'react'
import type { Routine, Turn } from '@openbot/db'
import { validateRoutineSchedule } from '@openbot/db/routine-schedule'
import { CalendarClock, Pause, Play, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import {
  addRoutine,
  changeRoutineEnabled,
  editRoutine,
  getRoutineHistory,
  getRoutines,
  removeRoutine,
  runRoutine,
} from '@/server/routines'

type Draft = {
  name: string
  instruction: string
  cronExpression: string
  timezone: string
  enabled: boolean
}

function blankDraft(timezone: string): Draft {
  return {
    name: '',
    instruction: '',
    cronExpression: '0 9 * * *',
    timezone: timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    enabled: true,
  }
}

function routineDraft(routine: Routine): Draft {
  return {
    name: routine.name,
    instruction: routine.instruction,
    cronExpression: routine.cronExpression,
    timezone: routine.timezone,
    enabled: routine.enabled,
  }
}

function formatTime(value: number | null) {
  return value == null ? 'Paused' : new Date(value).toLocaleString()
}

export function RoutinesDialog({
  open,
  onOpenChange,
  agentId,
  conversationId,
  defaultTimezone,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  agentId: string
  conversationId: string
  defaultTimezone: string
}) {
  const [routines, setRoutines] = useState<Routine[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft>(() => blankDraft(defaultTimezone))
  const [history, setHistory] = useState<Turn[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const selected = routines.find((routine) => routine.id === selectedId) ?? null

  async function refresh(preferredId = selectedId) {
    const rows = await getRoutines({ data: { agentId } })
    setRoutines(rows)
    const nextId = preferredId && rows.some((routine) => routine.id === preferredId)
      ? preferredId
      : rows[0]?.id ?? null
    setSelectedId(nextId)
    const next = rows.find((routine) => routine.id === nextId)
    if (next) {
      setDraft(routineDraft(next))
      setHistory(await getRoutineHistory({ data: { id: next.id } }))
    } else {
      setDraft(blankDraft(defaultTimezone))
      setHistory([])
    }
  }

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    setError('')
    getRoutines({ data: { agentId } })
      .then(async (rows) => {
        if (cancelled) return
        setRoutines(rows)
        const first = rows[0] ?? null
        setSelectedId(first?.id ?? null)
        setDraft(first ? routineDraft(first) : blankDraft(defaultTimezone))
        setHistory(first ? await getRoutineHistory({ data: { id: first.id } }) : [])
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Could not load routines')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [open, agentId, defaultTimezone])

  useEffect(() => {
    if (!open) return
    const source = new EventSource('/api/routines/stream')
    source.onmessage = (message) => {
      try {
        const event = JSON.parse(message.data) as { routineId?: string }
        if (event.routineId === selectedId) void refresh(selectedId)
      } catch { /* Ignore malformed live updates. */ }
    }
    return () => source.close()
  }, [open, selectedId, agentId])

  function select(routine: Routine) {
    setSelectedId(routine.id)
    setDraft(routineDraft(routine))
    setError('')
    void getRoutineHistory({ data: { id: routine.id } }).then(setHistory)
  }

  function startNew() {
    setSelectedId(null)
    setDraft(blankDraft(defaultTimezone))
    setHistory([])
    setError('')
  }

  async function save() {
    setSaving(true)
    setError('')
    try {
      validateRoutineSchedule(draft.cronExpression, draft.timezone)
      let saved: Routine
      if (selected) {
        saved = await editRoutine({
          data: {
            id: selected.id,
            name: draft.name,
            instruction: draft.instruction,
            cronExpression: draft.cronExpression,
            timezone: draft.timezone,
          },
        })
        if (saved.enabled !== draft.enabled) {
          saved = await changeRoutineEnabled({
            data: { id: saved.id, enabled: draft.enabled },
          })
        }
      } else {
        saved = await addRoutine({
          data: { agentId, conversationId, ...draft },
        })
      }
      await refresh(saved.id)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save routine')
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    if (!selected || !window.confirm(`Delete “${selected.name}”? Run history remains in its conversation.`)) return
    setSaving(true)
    try {
      await removeRoutine({ data: { id: selected.id } })
      await refresh(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not delete routine')
    } finally {
      setSaving(false)
    }
  }

  async function runNow() {
    if (!selected) return
    setSaving(true)
    setError('')
    try {
      await runRoutine({ data: { id: selected.id } })
      await refresh(selected.id)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not run routine')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarClock className="size-4" /> Routines
          </DialogTitle>
        </DialogHeader>
        <div className="grid min-h-96 gap-4 sm:grid-cols-[15rem_1fr]">
          <aside className="space-y-2 border-b pb-4 sm:border-r sm:border-b-0 sm:pr-4">
            <Button variant="outline" size="sm" className="w-full justify-start" onClick={startNew}>
              <Plus className="size-3.5" /> New routine
            </Button>
            {loading ? (
              <p className="text-xs text-muted-foreground">Loading…</p>
            ) : routines.length === 0 ? (
              <p className="text-xs text-muted-foreground">No routines yet.</p>
            ) : routines.map((routine) => (
              <button
                key={routine.id}
                type="button"
                onClick={() => select(routine)}
                className={`w-full rounded-lg border px-3 py-2 text-left ${selectedId === routine.id ? 'border-foreground/30 bg-muted' : 'bg-card hover:border-foreground/20'}`}
              >
                <div className="flex items-center gap-2">
                  <span className={`size-1.5 rounded-full ${routine.enabled ? 'bg-success' : 'bg-muted-foreground/40'}`} />
                  <span className="min-w-0 flex-1 truncate text-xs font-medium">{routine.name}</span>
                </div>
                <div className="mt-1 truncate font-mono text-[10px] text-muted-foreground">{routine.cronExpression}</div>
              </button>
            ))}
          </aside>
          <section className="space-y-4">
            <div className="grid gap-2">
              <Label htmlFor="routine-name">Name</Label>
              <Input id="routine-name" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Morning brief" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="routine-instruction">Instruction</Label>
              <Textarea id="routine-instruction" rows={5} value={draft.instruction} onChange={(event) => setDraft({ ...draft, instruction: event.target.value })} placeholder="Review my connected sources and send a concise brief…" />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="routine-cron">Cron schedule</Label>
                <Input id="routine-cron" className="font-mono" value={draft.cronExpression} onChange={(event) => setDraft({ ...draft, cronExpression: event.target.value })} />
                <p className="text-[10px] text-muted-foreground">minute hour day month weekday · minimum 15 minutes</p>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="routine-timezone">Timezone</Label>
                <Input id="routine-timezone" value={draft.timezone} onChange={(event) => setDraft({ ...draft, timezone: event.target.value })} placeholder="America/New_York" />
              </div>
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <div className="text-xs font-medium">Enabled</div>
                <div className="text-[10px] text-muted-foreground">
                  {selected ? `Next: ${formatTime(selected.nextRunAt)}` : 'Start on the next matching slot'}
                </div>
              </div>
              <Switch checked={draft.enabled} onCheckedChange={(enabled) => setDraft({ ...draft, enabled })} />
            </div>
            {selected && (
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-xs font-medium">Recent runs</h3>
                  <Button variant="outline" size="xs" onClick={runNow} disabled={saving}>
                    <Play className="size-3" /> Run now
                  </Button>
                </div>
                <div className="max-h-32 overflow-y-auto rounded-lg border">
                  {history.length === 0 ? (
                    <p className="p-3 text-[11px] text-muted-foreground">No runs yet.</p>
                  ) : history.map((turn) => (
                    <div key={turn.id} className="flex items-center gap-2 border-b px-3 py-2 text-[11px] last:border-b-0">
                      <span className="capitalize">{turn.status}</span>
                      <span className="flex-1 text-muted-foreground">{new Date(turn.createdAt).toLocaleString()}</span>
                      {turn.status === 'waiting' && <Pause className="size-3 text-warning" />}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {error && <p className="text-xs text-destructive">{error}</p>}
          </section>
        </div>
        <DialogFooter>
          {selected && (
            <Button variant="ghost" onClick={remove} disabled={saving} className="text-destructive sm:mr-auto">
              <Trash2 className="size-3.5" /> Delete
            </Button>
          )}
          <Button onClick={save} disabled={saving || !draft.name.trim() || !draft.instruction.trim()}>
            {saving ? 'Saving…' : selected ? 'Save changes' : 'Create routine'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
