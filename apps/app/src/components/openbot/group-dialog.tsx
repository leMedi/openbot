import { useEffect, useMemo, useRef, useState } from 'react'
import type { Conversation, Group } from '@openbot/db'
import { ArrowDown, ArrowUp, ImageUp, Plus, Trash2, X } from 'lucide-react'
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
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Textarea } from '@/components/ui/textarea'
import { addGroup, removeGroup, updateGroup, updateGroupMembers } from '@/server/groups'
import { BotAvatar } from './bot-avatar'
import type { Bot } from './data'
import {
  GROUP_AVATAR_COLOR,
  GROUP_AVATAR_SHAPE,
  groupAvatarUrl,
  groupMemberIds,
} from './groups'

const ACCEPTED_AVATAR_TYPES = 'image/png,image/jpeg,image/webp,image/gif'

export function GroupDialog({
  open,
  onOpenChange,
  group,
  agents,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** When set, the dialog edits an existing group; otherwise it creates one. */
  group: Group | null
  /** Local agents available as members, in display order. */
  agents: Bot[]
  /** On create, `sharedConversation` is the group's one persisted room. */
  onSaved: (saved: Group, sharedConversation: Conversation | null) => void
}) {
  const editing = !!group
  const [name, setName] = useState(group?.name ?? '')
  const [description, setDescription] = useState(group?.description ?? '')
  // Ordered member agent ids; the array order is the stored order.
  const [memberIds, setMemberIds] = useState<string[]>(() =>
    group ? groupMemberIds(group).filter((id) => agents.some((a) => a.id === id)) : [],
  )
  const [avatarFile, setAvatarFile] = useState<File | null>(null)
  const [avatarRemoved, setAvatarRemoved] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  // If creation succeeded but a follow-up step (avatar upload) failed,
  // retrying must update the group that already exists, not create another.
  const createdRef = useRef<{ group: Group; conversation: Conversation } | null>(null)

  const pendingAvatarUrl = useMemo(
    () => (avatarFile ? URL.createObjectURL(avatarFile) : undefined),
    [avatarFile],
  )
  useEffect(() => {
    return () => {
      if (pendingAvatarUrl) URL.revokeObjectURL(pendingAvatarUrl)
    }
  }, [pendingAvatarUrl])
  const savedAvatarUrl = group && !avatarRemoved ? groupAvatarUrl(group) : undefined
  const previewUrl = pendingAvatarUrl ?? savedAvatarUrl

  const members = memberIds
    .map((id) => agents.find((a) => a.id === id))
    .filter((a): a is Bot => !!a)
  const available = agents.filter((a) => !memberIds.includes(a.id))

  function moveMember(id: string, delta: -1 | 1) {
    setMemberIds((ids) => {
      const index = ids.indexOf(id)
      const target = index + delta
      if (index === -1 || target < 0 || target >= ids.length) return ids
      const next = [...ids]
      next[index] = next[target]
      next[target] = id
      return next
    })
  }

  async function save() {
    if (saving) return
    setSaving(true)
    setError(null)
    try {
      const membersInput = memberIds.map((agentId) => ({
        type: 'agent' as const,
        agentId,
      }))
      let saved: Group
      let sharedConversation: Conversation | null = null
      const existing = editing ? group : createdRef.current?.group
      if (existing) {
        saved = await updateGroup({
          data: { id: existing.id, patch: { name, description } },
        })
        saved = await updateGroupMembers({
          data: { id: existing.id, members: membersInput },
        })
        sharedConversation = createdRef.current?.conversation ?? null
      } else {
        const created = await addGroup({ data: { name, description, members: membersInput } })
        createdRef.current = created
        saved = created.group
        sharedConversation = created.conversation
      }

      if (avatarFile) {
        const form = new FormData()
        form.append('file', avatarFile)
        const response = await fetch(`/api/groups/${saved.id}/avatar`, {
          method: 'PUT',
          body: form,
        })
        if (!response.ok) {
          const body = await response.json().catch(() => null)
          throw new Error(body?.error ?? 'Avatar upload failed')
        }
      } else if (editing && avatarRemoved && group.avatarFileId) {
        const response = await fetch(`/api/groups/${saved.id}/avatar`, {
          method: 'DELETE',
        })
        if (!response.ok) {
          const body = await response.json().catch(() => null)
          throw new Error(body?.error ?? 'Removing the avatar failed')
        }
      }

      onSaved(saved, sharedConversation)
      onOpenChange(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Saving the group failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
        <DialogHeader className="shrink-0 border-b bg-card/50 px-4 py-3">
          <DialogTitle className="text-center text-sm">
            {editing ? `Edit ${group.name}` : 'New Group'}
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
                onChange={(e) => {
                  const file = e.target.files?.[0] ?? null
                  setAvatarFile(file)
                  if (file) setAvatarRemoved(false)
                }}
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
                        color={GROUP_AVATAR_COLOR}
                        shape={GROUP_AVATAR_SHAPE}
                        src={previewUrl}
                        className="size-16 rounded-xl text-2xl font-bold"
                      />
                    </button>
                  }
                />
                <PopoverContent align="start" className="w-56 p-2">
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
                    onClick={() => {
                      setAvatarFile(null)
                      setAvatarRemoved(true)
                    }}
                    className={
                      previewUrl
                        ? 'flex w-full items-center justify-center gap-2 rounded-md px-2 py-1.5 text-sm text-destructive hover:bg-muted'
                        : 'flex w-full cursor-not-allowed items-center justify-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground/50'
                    }
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
                  placeholder="sprint-room"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="text-[11px] font-semibold text-muted-foreground">
                  Description
                </Label>
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What this room is for."
                  className="min-h-16 text-xs"
                />
              </div>
            </div>
          </div>

          {/* Members: ordered list plus the remaining agents to add. */}
          <div className="flex flex-col gap-1.5">
            <Label className="text-[11px] font-semibold text-muted-foreground">Members</Label>
            {members.length > 0 ? (
              <div className="rounded-lg border">
                {members.map((bot, index) => (
                  <div
                    key={bot.id}
                    className="flex items-center gap-2.5 border-b px-3 py-2 last:border-b-0"
                  >
                    <span className="w-4 text-center text-[10px] text-muted-foreground/70">
                      {index + 1}
                    </span>
                    <BotAvatar
                      name={bot.name}
                      color={bot.color}
                      shape={bot.shape}
                      src={bot.avatarUrl}
                      className="size-6 text-[10px]"
                    />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                      {bot.name}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Move ${bot.name} up`}
                      disabled={index === 0}
                      onClick={() => moveMember(bot.id, -1)}
                    >
                      <ArrowUp className="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Move ${bot.name} down`}
                      disabled={index === members.length - 1}
                      onClick={() => moveMember(bot.id, 1)}
                    >
                      <ArrowDown className="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Remove ${bot.name}`}
                      onClick={() => setMemberIds((ids) => ids.filter((x) => x !== bot.id))}
                    >
                      <X className="size-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed px-3 py-4 text-center text-xs text-muted-foreground/70">
                No members yet — add at least one bot so the room can answer.
              </div>
            )}
            {available.length > 0 && (
              <div className="max-h-40 overflow-y-auto rounded-lg border">
                {available.map((bot) => (
                  <button
                    key={bot.id}
                    type="button"
                    onClick={() => setMemberIds((ids) => [...ids, bot.id])}
                    className="flex w-full items-center gap-2.5 border-b px-3 py-2 text-left last:border-b-0 hover:bg-muted/50"
                  >
                    <BotAvatar
                      name={bot.name}
                      color={bot.color}
                      shape={bot.shape}
                      src={bot.avatarUrl}
                      className="size-6 text-[10px]"
                    />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                      {bot.name}
                    </span>
                    <Plus className="size-3.5 text-muted-foreground" />
                  </button>
                ))}
              </div>
            )}
            <p className="text-[11px] leading-normal text-muted-foreground/70">
              Members share one room. The order above is the response order.
            </p>
          </div>
        </div>

        <DialogFooter className="mx-0 mb-0 shrink-0 items-center border-t bg-card/50 px-5 py-3">
          <span className="mr-auto min-w-0 truncate text-[11px] text-muted-foreground/70">
            {error ? (
              <span className="text-destructive">{error}</span>
            ) : editing ? (
              'Changes apply to the shared room.'
            ) : (
              'Creates the shared room.'
            )}
          </span>
          <Button size="sm" disabled={!name.trim() || saving} onClick={save}>
            {saving ? 'Saving…' : editing ? 'Save Changes' : 'Create Group'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function DeleteGroupDialog({
  group,
  onOpenChange,
  onDeleted,
}: {
  group: Group | null
  onOpenChange: (open: boolean) => void
  onDeleted: (result: { id: string; conversationId: string | null }) => void
}) {
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function confirm() {
    if (!group || deleting) return
    setDeleting(true)
    setError(null)
    try {
      const result = await removeGroup({ data: { id: group.id } })
      onDeleted(result)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Deleting the group failed')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <Dialog open={!!group} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Delete “{group?.name}”?</DialogTitle>
        </DialogHeader>
        <p className="text-xs leading-normal text-muted-foreground">
          This deletes the group and its shared conversation history. Member bots and
          their private conversations are not affected.
        </p>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="secondary" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="destructive" size="sm" disabled={deleting} onClick={confirm}>
            {deleting ? 'Deleting…' : 'Delete'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
