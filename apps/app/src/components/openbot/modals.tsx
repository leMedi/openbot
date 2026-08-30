import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
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
                <BotAvatar name={b.name} color={b.color} src={b.avatarUrl} />
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

export function NewChannelDialog({
  open,
  onOpenChange,
  bots,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  bots: Bot[]
}) {
  const [name, setName] = useState('')
  const [picked, setPicked] = useState<string[]>([])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-md">
        <DialogHeader className="border-b bg-card/50 px-4 py-3">
          <DialogTitle className="text-center text-sm">New Channel</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4 px-5 py-4">
          <div className="flex flex-col gap-1.5">
            <Label className="text-[11px] font-semibold text-muted-foreground">Title</Label>
            <div className="relative">
              <span className="absolute top-1/2 left-2.5 -translate-y-1/2 text-sm font-semibold text-muted-foreground/70">
                #
              </span>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="sprint-room"
                className="pl-6.5"
              />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-[11px] font-semibold text-muted-foreground">Bots</Label>
            <div className="max-h-52 overflow-y-auto rounded-lg border">
              {bots.map((b) => (
                <label
                  key={b.id}
                  className="flex cursor-pointer items-center gap-2.5 border-b px-3 py-2 last:border-b-0 hover:bg-muted/50"
                >
                  <BotAvatar
                    name={b.name}
                    color={b.color}
                    src={b.avatarUrl}
                    className="size-6 text-[10px]"
                  />
                  <span className="flex min-w-0 flex-1 items-baseline gap-2">
                    <span className="text-sm font-medium">{b.name}</span>
                    <span className="text-[10px] text-muted-foreground">{b.model}</span>
                  </span>
                  <Checkbox
                    checked={picked.includes(b.id)}
                    onCheckedChange={() =>
                      setPicked((p) =>
                        p.includes(b.id) ? p.filter((x) => x !== b.id) : [...p, b.id],
                      )
                    }
                  />
                </label>
              ))}
            </div>
            <p className="text-[11px] leading-normal text-muted-foreground/70">
              Every bot in the channel sees the conversation and can reply.
            </p>
          </div>
        </div>
        <DialogFooter className="mx-0 mb-0 items-center border-t bg-card/50 px-5 py-3">
          <span className="mr-auto text-[11px] text-muted-foreground/70">
            {picked.length === 0
              ? 'Pick at least one bot'
              : `${picked.length} bot${picked.length === 1 ? '' : 's'} selected`}
          </span>
          <Button
            size="sm"
            disabled={!name || picked.length === 0}
            onClick={() => onOpenChange(false)}
          >
            Create Channel
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
