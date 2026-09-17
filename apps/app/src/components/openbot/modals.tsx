import { useState } from 'react'
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
import { botIn, type Bot, type Conversation } from '@openbot/client/openbot/data'

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
          This removes the conversation history and starts fresh.
          {bot?.kind === 'group'
            ? ' Member bots are not affected.'
            : ` ${bot?.name ?? 'The bot'} keeps its memory and group chat memberships.`}
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
