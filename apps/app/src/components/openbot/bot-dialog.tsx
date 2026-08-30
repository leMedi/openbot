import { useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { BotAvatar } from './bot-avatar'
import {
  AVATAR_COLORS,
  AVATAR_SHAPES,
  initialOf,
  MODEL_GROUPS,
  PLUGINS,
  type Bot,
} from './data'

export function BotDialog({
  open,
  onOpenChange,
  bot,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** When set, the dialog edits an existing bot; otherwise it creates one. */
  bot: Bot | null
}) {
  const editing = !!bot
  const [name, setName] = useState(bot?.name ?? '')
  const [model, setModel] = useState(bot?.model ?? 'Sonnet 4.5')
  const [shape, setShape] = useState(AVATAR_SHAPES[1])
  const [color, setColor] = useState(bot?.color ?? AVATAR_COLORS[6])
  const [grants, setGrants] = useState<string[]>(
    bot?.grants.map(([p, a]) => `${p}:${a}`) ?? [],
  )
  const [deleteOpen, setDeleteOpen] = useState(false)

  const accounts = PLUGINS.filter((p) => p.installed).flatMap((p) =>
    p.accounts.map((a) => ({ plugin: p, account: a, key: `${p.id}:${a.id}` })),
  )
  const modelProvider =
    MODEL_GROUPS.find((g) => g.models.includes(model)) ?? MODEL_GROUPS[0]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
        <DialogHeader className="shrink-0 border-b bg-card/50 px-4 py-3">
          <DialogTitle className="text-center text-sm">
            {editing ? `Edit ${bot.name}` : 'New Bot'}
          </DialogTitle>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-x-hidden overflow-y-auto px-5 py-5">
          <div className="flex gap-4">
            {/* Avatar */}
            <div className="flex w-21 shrink-0 flex-col gap-1.5">
              <Label className="text-[11px] font-semibold text-muted-foreground">Avatar</Label>
              <Popover>
                <PopoverTrigger
                  render={
                    <button
                      type="button"
                      title="Change avatar"
                      className="flex size-21 items-center justify-center rounded-2xl border border-input bg-transparent transition-colors hover:border-foreground/25 dark:bg-input/30"
                    >
                      <span className="relative size-16">
                        <svg width="64" height="64" viewBox="0 0 48 48">
                          <path d={shape.d} fill={color} />
                        </svg>
                        <span
                          className={cn(
                            'absolute inset-0 flex items-center justify-center text-2xl font-bold',
                            color === '#f2f2f2' ? 'text-muted-foreground' : 'text-white',
                          )}
                        >
                          {initialOf(name)}
                        </span>
                      </span>
                    </button>
                  }
                />
                <PopoverContent align="start" className="w-64 p-2.5">
                  <div className="flex flex-wrap justify-center gap-1">
                    {AVATAR_SHAPES.map((sh) => (
                      <button
                        key={sh.id}
                        type="button"
                        title={sh.id}
                        onClick={() => setShape(sh)}
                        className={cn(
                          'flex size-12 items-center justify-center rounded-lg hover:bg-muted',
                          sh.id === shape.id && 'ring-2 ring-info',
                        )}
                      >
                        <svg width="36" height="36" viewBox="0 0 48 48">
                          <path d={sh.d} fill={color} />
                        </svg>
                      </button>
                    ))}
                  </div>
                  <div className="mx-auto mt-3 flex max-w-40 flex-wrap justify-center gap-2">
                    {AVATAR_COLORS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setColor(c)}
                        className={cn(
                          'size-5.5 rounded-full',
                          c === color && 'ring-2 ring-info ring-offset-2 ring-offset-popover',
                        )}
                        style={{ background: c }}
                      />
                    ))}
                  </div>
                </PopoverContent>
              </Popover>
            </div>

            <div className="flex min-w-0 flex-1 flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <Label className="text-[11px] font-semibold text-muted-foreground">Name</Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ops Watch"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="text-[11px] font-semibold text-muted-foreground">Model</Label>
                <Popover>
                  <PopoverTrigger
                    render={
                      <button
                        type="button"
                        className="flex h-8 items-center gap-2 rounded-lg border border-input bg-transparent px-2.5 text-sm transition-colors hover:border-foreground/25 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none dark:bg-input/30"
                      >
                        <BotAvatar
                          name={modelProvider.provider}
                          color={modelProvider.hue}
                          className="size-4 rounded-sm text-[8px]"
                        />
                        <span className="flex-1 truncate text-left">{model}</span>
                        <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
                      </button>
                    }
                  />
                  <PopoverContent align="start" className="w-60 p-1">
                    {MODEL_GROUPS.map((g) => (
                      <div key={g.provider}>
                        <div className="flex items-center gap-1.5 px-2 pt-1.5 pb-1">
                          <BotAvatar
                            name={g.provider}
                            color={g.hue}
                            className="size-3.5 rounded-sm text-[7px]"
                          />
                          <span className="text-[10px] font-semibold text-muted-foreground">
                            {g.provider}
                          </span>
                        </div>
                        {g.models.map((m) => (
                          <button
                            key={m}
                            type="button"
                            onClick={() => setModel(m)}
                            className="flex w-full items-center gap-2 rounded-md py-1.5 pr-2 pl-7 text-sm hover:bg-muted"
                          >
                            <span className="flex-1 text-left">{m}</span>
                            {m === model && <Check className="size-3 text-info" />}
                          </button>
                        ))}
                      </div>
                    ))}
                  </PopoverContent>
                </Popover>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label className="text-[11px] font-semibold text-muted-foreground">
              Instructions
            </Label>
            <Textarea
              defaultValue={bot?.prompt}
              placeholder="You keep an eye on the sprint board. Flag anything stale, never invent ticket numbers."
              className="min-h-21 text-xs"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="flex items-baseline gap-2">
              <Label className="flex-1 text-[11px] font-semibold text-muted-foreground">
                Plugin Accounts
              </Label>
              <span className="text-xs font-medium text-info">Browse Catalog</span>
            </div>
            <div className="max-h-48 overflow-y-auto rounded-lg border">
              {accounts.map(({ plugin, account, key }) => (
                <label
                  key={key}
                  className="flex cursor-pointer items-center gap-2.5 border-b px-3 py-2 last:border-b-0 hover:bg-muted/50"
                >
                  <BotAvatar
                    name={plugin.name}
                    color={plugin.hue}
                    className="size-5.5 text-[9px]"
                  />
                  <span className="flex min-w-0 flex-1 items-baseline gap-2">
                    <span className="text-sm font-medium">{plugin.name}</span>
                    <span className="text-[10px] text-muted-foreground">{account.name}</span>
                  </span>
                  <Checkbox
                    checked={grants.includes(key)}
                    onCheckedChange={() =>
                      setGrants((g) =>
                        g.includes(key) ? g.filter((x) => x !== key) : [...g, key],
                      )
                    }
                  />
                </label>
              ))}
            </div>
          </div>

          {editing && (
            <div className="flex flex-col gap-1.5">
              <Label className="text-[11px] font-semibold text-destructive">Danger Zone</Label>
              <div className="flex items-center gap-3 rounded-lg border border-destructive/35 px-3.5 py-3">
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold text-destructive">Delete Bot</div>
                  <div className="mt-0.5 text-[11px] text-muted-foreground">
                    Deletes this bot and all of its conversations.
                  </div>
                </div>
                <Button variant="destructive" size="xs" onClick={() => setDeleteOpen(true)}>
                  Delete…
                </Button>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="mx-0 mb-0 shrink-0 items-center border-t bg-card/50 px-5 py-3">
          <span className="mr-auto text-[11px] text-muted-foreground/70">
            {editing ? 'Changes apply to every conversation.' : 'Starts a first conversation.'}
          </span>
          <Button size="sm" onClick={() => onOpenChange(false)}>
            {editing ? 'Save Changes' : 'Create Bot'}
          </Button>
        </DialogFooter>

        <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>Delete {bot?.name}?</DialogTitle>
            </DialogHeader>
            <p className="text-xs leading-normal text-muted-foreground">
              This deletes the bot and its conversations, including their full history. This can't
              be undone.
            </p>
            <DialogFooter>
              <Button variant="secondary" size="sm" onClick={() => setDeleteOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => {
                  setDeleteOpen(false)
                  onOpenChange(false)
                }}
              >
                Delete Bot
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  )
}
