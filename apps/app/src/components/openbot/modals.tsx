import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { BotAvatar } from './bot-avatar'
import { botIn, type Bot, type Conversation } from './data'

export function NewConversationDialog({
  open,
  onOpenChange,
  onPick,
  bots,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onPick: (botId: string) => void
  bots: Bot[]
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-sm">
        <DialogHeader className="border-b bg-card/50 px-4 py-3">
          <DialogTitle className="text-center text-sm">New Conversation</DialogTitle>
        </DialogHeader>
        <Command className="bg-transparent">
          <CommandInput placeholder="Search bots" />
          <CommandList className="p-1.5">
            <CommandEmpty>No bots match</CommandEmpty>
            {bots.map((b) => (
              <CommandItem key={b.id} value={b.name} onSelect={() => onPick(b.id)}>
                <BotAvatar name={b.name} color={b.color} shape={b.shape} src={b.avatarUrl} />
                <span className="flex min-w-0 flex-1 items-baseline gap-2">
                  <span className="truncate text-sm font-medium">{b.name}</span>
                  <span className="text-[10px] text-muted-foreground">{b.model}</span>
                </span>
                <span className="text-xs text-muted-foreground/70">›</span>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  )
}

export function RenameConversationDialog({
  conversation,
  onOpenChange,
  onSubmit,
}: {
  conversation: Conversation | null
  onOpenChange: (open: boolean) => void
  onSubmit: (title: string) => void
}) {
  const [title, setTitle] = useState('')

  // Reset the draft each time the dialog opens for a conversation.
  const [seededFor, setSeededFor] = useState<string | null>(null)
  if (conversation && seededFor !== conversation.id) {
    setSeededFor(conversation.id)
    setTitle(conversation.title)
  }

  const trimmed = title.trim()

  return (
    <Dialog open={!!conversation} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Rename conversation</DialogTitle>
        </DialogHeader>
        <form
          className="contents"
          onSubmit={(e) => {
            e.preventDefault()
            if (trimmed) onSubmit(trimmed)
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label className="text-[11px] font-semibold text-muted-foreground">
              Title
            </Label>
            <Input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Conversation title"
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={!trimmed}>
              Rename
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function ClearConversationDialog({
  conversation,
  onOpenChange,
  onConfirm,
  bots,
}: {
  conversation: Conversation | null
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
  bots: Bot[]
}) {
  const bot = conversation ? botIn(bots, conversation.botId) : null

  return (
    <Dialog open={!!conversation} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Clear “{conversation?.title}”?</DialogTitle>
        </DialogHeader>
        <p className="text-xs leading-normal text-muted-foreground">
          This removes the conversation history and starts fresh. {bot?.name} keeps its
          memory and other conversations.
        </p>
        <DialogFooter>
          <Button variant="secondary" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="destructive" size="sm" onClick={onConfirm}>
            Clear history
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function DeleteConversationDialog({
  conversation,
  onOpenChange,
  onConfirm,
  bots,
}: {
  conversation: Conversation | null
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
  bots: Bot[]
}) {
  const bot = conversation ? botIn(bots, conversation.botId) : null

  return (
    <Dialog open={!!conversation} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Delete “{conversation?.title}”?</DialogTitle>
        </DialogHeader>
        <p className="text-xs leading-normal text-muted-foreground">
          This deletes the conversation and its history. {bot?.name} and its other conversations
          are not affected.
        </p>
        <DialogFooter>
          <Button variant="secondary" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="destructive" size="sm" onClick={onConfirm}>
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
