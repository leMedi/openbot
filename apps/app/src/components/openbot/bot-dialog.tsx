import { useEffect, useMemo, useRef, useState } from 'react'
import type { Agent } from '@openbot/db'
import { Check, ChevronDown, ImageUp, Trash2 } from 'lucide-react'
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
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { addAgent, updateAgent } from '@/server/agents'
import { agentAvatarUrl, agentColor } from './agents'
import { BotAvatar } from './bot-avatar'
import { initialOf, MODEL_GROUPS, PLUGINS } from './data'

const ACCEPTED_AVATAR_TYPES = 'image/png,image/jpeg,image/webp,image/gif'

export function BotDialog({
  open,
  onOpenChange,
  agent,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** When set, the dialog edits an existing agent; otherwise it creates one. */
  agent: Agent | null
  onSaved: () => void
}) {
  const editing = !!agent
  const [name, setName] = useState(agent?.name ?? '')
  const [title, setTitle] = useState(agent?.title ?? '')
  const [description, setDescription] = useState(agent?.description ?? '')
  const [model, setModel] = useState(agent?.defaultModel ?? 'Sonnet 4.5')
  const [notifyOnUpdates, setNotifyOnUpdates] = useState(agent?.notifyOnUpdates ?? true)
  const [hiddenFromSidebar, setHiddenFromSidebar] = useState(
    agent?.hiddenFromSidebar ?? false,
  )
  const [avatarFile, setAvatarFile] = useState<File | null>(null)
  const [avatarRemoved, setAvatarRemoved] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [grants, setGrants] = useState<string[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

  const color = agent ? agentColor(agent.id) : '#5865c4'
  const pendingAvatarUrl = useMemo(
    () => (avatarFile ? URL.createObjectURL(avatarFile) : undefined),
    [avatarFile],
  )
  useEffect(() => {
    return () => {
      if (pendingAvatarUrl) URL.revokeObjectURL(pendingAvatarUrl)
    }
  }, [pendingAvatarUrl])
  const savedAvatarUrl = agent && !avatarRemoved ? agentAvatarUrl(agent) : undefined
  const previewUrl = pendingAvatarUrl ?? savedAvatarUrl

  const accounts = PLUGINS.filter((p) => p.installed).flatMap((p) =>
    p.accounts.map((a) => ({ plugin: p, account: a, key: `${p.id}:${a.id}` })),
  )
  const modelProvider =
    MODEL_GROUPS.find((g) => g.models.includes(model)) ?? MODEL_GROUPS[0]

  function pickAvatar(file: File | null) {
    setAvatarFile(file)
    if (file) setAvatarRemoved(false)
  }

  async function save() {
    if (saving) return
    setSaving(true)
    setError(null)
    try {
      const profile = {
        name,
        title,
        description,
        defaultModel: model || null,
        notifyOnUpdates,
        hiddenFromSidebar,
      }
      const saved = editing
        ? await updateAgent({ data: { id: agent.id, patch: profile } })
        : await addAgent({ data: profile })

      if (avatarFile) {
        const form = new FormData()
        form.append('file', avatarFile)
        const response = await fetch(`/api/agents/${saved.id}/avatar`, {
          method: 'PUT',
          body: form,
        })
        if (!response.ok) {
          const body = await response.json().catch(() => null)
          throw new Error(body?.error ?? 'Avatar upload failed')
        }
      } else if (editing && avatarRemoved && agent.avatarFileId) {
        const response = await fetch(`/api/agents/${saved.id}/avatar`, {
          method: 'DELETE',
        })
        if (!response.ok) {
          const body = await response.json().catch(() => null)
          throw new Error(body?.error ?? 'Removing the avatar failed')
        }
      }

      onSaved()
      onOpenChange(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Saving the bot failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
        <DialogHeader className="shrink-0 border-b bg-card/50 px-4 py-3">
          <DialogTitle className="text-center text-sm">
            {editing ? `Edit ${agent.name}` : 'New Bot'}
          </DialogTitle>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-x-hidden overflow-y-auto px-5 py-5">
          <div className="flex gap-4">
            {/* Avatar */}
            <div className="flex w-21 shrink-0 flex-col gap-1.5">
              <Label className="text-[11px] font-semibold text-muted-foreground">Avatar</Label>
              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPTED_AVATAR_TYPES}
                className="hidden"
                onChange={(e) => pickAvatar(e.target.files?.[0] ?? null)}
              />
              <Popover>
                <PopoverTrigger
                  render={
                    <button
                      type="button"
                      title="Change avatar"
                      className="flex size-21 items-center justify-center rounded-2xl border border-input bg-transparent transition-colors hover:border-foreground/25 dark:bg-input/30"
                    >
                      {previewUrl ? (
                        <img
                          src={previewUrl}
                          alt="Avatar preview"
                          className="size-16 rounded-xl object-cover"
                        />
                      ) : (
                        <span
                          className="flex size-16 items-center justify-center rounded-xl text-2xl font-bold text-white"
                          style={{ background: color }}
                        >
                          {initialOf(name)}
                        </span>
                      )}
                    </button>
                  }
                />
                <PopoverContent align="start" className="w-52 p-1.5">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
                  >
                    <ImageUp className="size-3.5 text-muted-foreground" />
                    Upload image…
                  </button>
                  <button
                    type="button"
                    disabled={!previewUrl}
                    onClick={() => {
                      setAvatarFile(null)
                      setAvatarRemoved(true)
                    }}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm',
                      previewUrl
                        ? 'text-destructive hover:bg-muted'
                        : 'cursor-not-allowed text-muted-foreground/50',
                    )}
                  >
                    <Trash2 className="size-3.5" />
                    Remove image
                  </button>
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
                <Label className="text-[11px] font-semibold text-muted-foreground">Title</Label>
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="On-call sentinel"
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
              Description
            </Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="You keep an eye on the sprint board. Flag anything stale, never invent ticket numbers."
              className="min-h-21 text-xs"
            />
          </div>

          <div className="flex flex-col gap-2 rounded-lg border px-3.5 py-3">
            <label className="flex cursor-pointer items-center gap-3">
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-semibold">Notify on updates</span>
                <span className="mt-0.5 block text-[11px] text-muted-foreground">
                  Send a notification when this bot posts an update.
                </span>
              </span>
              <Switch checked={notifyOnUpdates} onCheckedChange={setNotifyOnUpdates} />
            </label>
            <label className="flex cursor-pointer items-center gap-3">
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-semibold">Hide from sidebar</span>
                <span className="mt-0.5 block text-[11px] text-muted-foreground">
                  Keep the bot running without showing it in navigation.
                </span>
              </span>
              <Switch checked={hiddenFromSidebar} onCheckedChange={setHiddenFromSidebar} />
            </label>
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
        </div>

        <DialogFooter className="mx-0 mb-0 shrink-0 items-center border-t bg-card/50 px-5 py-3">
          <span className="mr-auto min-w-0 truncate text-[11px] text-muted-foreground/70">
            {error ? (
              <span className="text-destructive">{error}</span>
            ) : editing ? (
              'Changes apply to every conversation.'
            ) : (
              'Starts a first conversation.'
            )}
          </span>
          <Button size="sm" disabled={!name.trim() || saving} onClick={save}>
            {saving ? 'Saving…' : editing ? 'Save Changes' : 'Create Bot'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
