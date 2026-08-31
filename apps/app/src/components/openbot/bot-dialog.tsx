import { useEffect, useMemo, useRef, useState } from 'react'
import type { Agent, Conversation, SafeMcpAccount, SafeMcpServer } from '@openbot/db'
import { ImageUp, Lock, Trash2 } from 'lucide-react'
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { addAgent, updateAgent } from '@/server/agents'
import { agentAvatarUrl } from './agents'
import { BotAvatar } from './bot-avatar'
import { AVATAR_COLORS, AVATAR_SHAPES } from './data'

const ACCEPTED_AVATAR_TYPES = 'image/png,image/jpeg,image/webp,image/gif'

export function BotDialog({
  open,
  onOpenChange,
  agent,
  serverModel,
  mcpServers,
  mcpAccounts,
  grantedAccountIds,
  onOpenPlugins,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** When set, the dialog edits an existing agent; otherwise it creates one. */
  agent: Agent | null
  /** Server-configured model (OPENBOT_AI_MODEL); read-only until model providers land. */
  serverModel: string
  mcpServers: SafeMcpServer[]
  mcpAccounts: SafeMcpAccount[]
  grantedAccountIds: string[]
  onOpenPlugins: () => void
  /** On create, `firstConversation` is the persisted conversation named after the agent. */
  onSaved: (saved: Agent, firstConversation: Conversation | null) => void
}) {
  const editing = !!agent
  const [name, setName] = useState(agent?.name ?? '')
  const [description, setDescription] = useState(agent?.description ?? '')
  const [notifyOnUpdates, setNotifyOnUpdates] = useState(agent?.notifyOnUpdates ?? true)
  const [hiddenFromSidebar, setHiddenFromSidebar] = useState(
    agent?.hiddenFromSidebar ?? false,
  )
  const [shape, setShape] = useState(
    () => AVATAR_SHAPES.find((s) => s.id === agent?.avatarShape) ?? AVATAR_SHAPES[1],
  )
  const [color, setColor] = useState(agent?.avatarColor ?? AVATAR_COLORS[6])
  const [avatarFile, setAvatarFile] = useState<File | null>(null)
  const [avatarRemoved, setAvatarRemoved] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [grants, setGrants] = useState<string[]>(grantedAccountIds)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const createdRef = useRef<{ agent: Agent; conversation: Conversation } | null>(null)

  const pendingAvatarUrl = useMemo(
    () => (avatarFile ? URL.createObjectURL(avatarFile) : undefined),
    [avatarFile],
  )
  useEffect(() => {
    return () => {
      if (pendingAvatarUrl) URL.revokeObjectURL(pendingAvatarUrl)
    }
  }, [pendingAvatarUrl])
  useEffect(() => {
    const available = new Set(mcpAccounts.map((account) => account.id))
    setGrants((current) => current.filter((accountId) => available.has(accountId)))
  }, [mcpAccounts])
  const savedAvatarUrl = agent && !avatarRemoved ? agentAvatarUrl(agent) : undefined
  const previewUrl = pendingAvatarUrl ?? savedAvatarUrl

  const accounts = mcpAccounts.map((account) => ({
    account,
    server: mcpServers.find((server) => server.id === account.serverId),
  }))

  function pickAvatar(file: File | null) {
    setAvatarFile(file)
    if (file) setAvatarRemoved(false)
  }

  // Shape and image are mutually exclusive: picking a shape or color discards
  // any pending or saved image so the choice shows up in the preview.
  function clearImage() {
    setAvatarFile(null)
    setAvatarRemoved(true)
  }

  async function save() {
    if (saving) return
    setSaving(true)
    setError(null)
    try {
      const profile = {
        name,
        description,
        avatarShape: shape.id,
        avatarColor: color,
        notifyOnUpdates,
        hiddenFromSidebar,
      }
      let saved: Agent
      let firstConversation: Conversation | null = null
      const existing = editing ? agent : createdRef.current?.agent
      if (existing) {
        saved = await updateAgent({
          data: { id: existing.id, patch: profile, mcpAccountIds: grants },
        })
        firstConversation = createdRef.current?.conversation ?? null
      } else {
        const created = await addAgent({ data: { ...profile, mcpAccountIds: grants } })
        createdRef.current = created
        saved = created.agent
        firstConversation = created.conversation
      }

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

      onSaved(saved, firstConversation)
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
                      <BotAvatar
                        name={name}
                        color={color}
                        shape={shape.id}
                        src={previewUrl}
                        className="size-16 rounded-xl text-2xl font-bold"
                      />
                    </button>
                  }
                />
                <PopoverContent align="start" className="w-64 p-2.5">
                  <Tabs defaultValue={previewUrl ? 'image' : 'shape'} className="flex-col">
                    <TabsList className="mb-2 h-auto justify-start gap-1 bg-transparent p-0">
                      <TabsTrigger
                        value="shape"
                        className="h-auto flex-none rounded-md px-2 py-0.5 text-xs border-0"
                      >
                        Bot
                      </TabsTrigger>
                      <TabsTrigger
                        value="image"
                        className="h-auto flex-none rounded-md px-2 py-0.5 text-xs border-0"
                      >
                        Upload
                      </TabsTrigger>
                    </TabsList>
                    <TabsContent value="shape">
                      <div className="flex flex-wrap justify-center gap-1">
                        {AVATAR_SHAPES.map((sh) => (
                          <button
                            key={sh.id}
                            type="button"
                            title={sh.id}
                            onClick={() => {
                              setShape(sh)
                              clearImage()
                            }}
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
                      <div className="mx-auto mt-3 flex max-w-40 flex-wrap justify-center gap-3">
                        {AVATAR_COLORS.map((c) => (
                          <button
                            key={c}
                            type="button"
                            onClick={() => {
                              setColor(c)
                              clearImage()
                            }}
                            className={cn(
                              'size-5.5 rounded-full',
                              c === color &&
                                'ring-2 ring-info ring-offset-2 ring-offset-popover',
                            )}
                            style={{ background: c }}
                          />
                        ))}
                      </div>
                    </TabsContent>
                    <TabsContent value="image">
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="flex w-full items-center justify-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
                      >
                        <ImageUp className="size-3.5 text-muted-foreground" />
                        Upload image…
                      </button>
                      <button
                        type="button"
                        disabled={!previewUrl}
                        onClick={clearImage}
                        className={cn(
                          'flex w-full items-center gap-2 justify-center rounded-md px-2 py-1.5 text-sm',
                          previewUrl
                            ? 'text-destructive hover:bg-muted'
                            : 'cursor-not-allowed text-muted-foreground/50',
                        )}
                      >
                        <Trash2 className="size-3.5" />
                        Remove image
                      </button>
                    </TabsContent>
                  </Tabs>
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
                <div
                  title="Configured by the server (OPENBOT_AI_MODEL)"
                  className="flex h-8 cursor-not-allowed items-center gap-2 rounded-lg border border-input bg-muted/40 px-2.5 text-sm text-muted-foreground dark:bg-input/20"
                >
                  <span className="flex-1 truncate text-left">
                    {serverModel || 'Not configured'}
                  </span>
                  <Lock className="size-3 shrink-0" />
                </div>
                <p className="text-[10px] leading-normal text-muted-foreground/70">
                  Set by the server. Model selection is coming with providers.
                </p>
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
              <button
                type="button"
                onClick={onOpenPlugins}
                className="text-xs font-medium text-info hover:opacity-80"
              >
                Manage MCPs
              </button>
            </div>
            <div className="max-h-48 overflow-y-auto rounded-lg border">
              {accounts.map(({ server, account }) => (
                <label
                  key={account.id}
                  className="flex cursor-pointer items-center gap-2.5 border-b px-3 py-2 last:border-b-0 hover:bg-muted/50"
                >
                  <BotAvatar
                    name={server?.name ?? account.label}
                    color="#3b82f6"
                    className="size-5.5 text-[9px]"
                  />
                  <span className="flex min-w-0 flex-1 items-baseline gap-2">
                    <span className="text-sm font-medium">{server?.name ?? 'MCP'}</span>
                    <span className="text-[10px] text-muted-foreground">{account.label}</span>
                  </span>
                  <Checkbox
                    checked={grants.includes(account.id)}
                    onCheckedChange={() =>
                      setGrants((g) =>
                        g.includes(account.id)
                          ? g.filter((x) => x !== account.id)
                          : [...g, account.id],
                      )
                    }
                  />
                </label>
              ))}
              {accounts.length === 0 && (
                <p className="px-3 py-3 text-xs text-muted-foreground">
                  Add an MCP account before granting access.
                </p>
              )}
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
