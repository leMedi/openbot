import { useState } from 'react'
import {
  ArrowUp,
  BotIcon,
  CheckCircle2,
  Copy,
  FolderPlus,
  Hash,
  MessageCircle,
  Pencil,
  Pin,
  Plug,
  Plus,
  Search,
  Settings,
  Trash2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { BotAvatar } from './bot-avatar'
import { botById, type Conversation } from './data'

type SidebarProps = {
  conversations: Conversation[]
  activeId: string
  onSelect: (id: string) => void
  onNewBot: () => void
  onNewConversation: () => void
  onNewChannel: () => void
  onOpenPlugins: () => void
  onOpenSettings: () => void
  onDeleteConversation: (id: string) => void
}

export function Sidebar({
  conversations,
  activeId,
  onSelect,
  onNewBot,
  onNewConversation,
  onNewChannel,
  onOpenPlugins,
  onOpenSettings,
  onDeleteConversation,
}: SidebarProps) {
  const [search, setSearch] = useState('')

  const filtered = conversations.filter((c) =>
    (c.title + botById(c.botId).name).toLowerCase().includes(search.toLowerCase()),
  )
  const pinned = filtered.filter((c) => c.pinned)
  const rest = filtered.filter((c) => !c.pinned)

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r bg-sidebar">
      <div className="flex gap-2 p-2.5 pb-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search"
            className="h-7.5 bg-background/60 pl-7 text-sm dark:bg-background/60"
          />
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="ghost" size="icon-sm" aria-label="New…">
                <Plus className="size-3.5" />
              </Button>
            }
          />
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem onClick={onNewBot}>
              <BotIcon /> New Bot
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onNewConversation}>
              <MessageCircle /> New Conversation
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onNewChannel}>
              <Hash /> New Channel
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-2 pb-2">
        {pinned.length > 0 && (
          <div className="px-2 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-muted-foreground">
            Pinned
          </div>
        )}
        {[...pinned, ...rest].map((c) => (
          <ConversationRow
            key={c.id}
            conversation={c}
            active={c.id === activeId}
            onSelect={() => onSelect(c.id)}
            onDelete={() => onDeleteConversation(c.id)}
          />
        ))}
        {filtered.length === 0 && (
          <div className="px-2 py-6 text-center text-xs text-muted-foreground">
            No conversations match
          </div>
        )}
      </div>

      <div className="border-t p-2">
        <button
          type="button"
          onClick={onOpenPlugins}
          className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-sm font-medium hover:bg-muted"
        >
          <Plug className="size-4 text-muted-foreground" />
          Plugins
        </button>
        <button
          type="button"
          onClick={onOpenSettings}
          className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-sm hover:bg-muted"
        >
          <Settings className="size-4 text-muted-foreground" />
          <span className="flex-1 text-left">Settings</span>
          <span
            title="Upgrade available"
            className="flex size-4 items-center justify-center rounded-full bg-primary text-white"
          >
            <ArrowUp className="size-2.5" />
          </span>
        </button>
      </div>
    </aside>
  )
}

function ConversationRow({
  conversation,
  active,
  onSelect,
  onDelete,
}: {
  conversation: Conversation
  active: boolean
  onSelect: () => void
  onDelete: () => void
}) {
  const bot = botById(conversation.botId)
  const last = conversation.messages[conversation.messages.length - 1]

  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={
          <button
            type="button"
            onClick={onSelect}
            className={cn(
              'flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left',
              active ? 'bg-primary text-white' : 'hover:bg-muted',
            )}
          >
            <BotAvatar name={bot.name} color={bot.color} />
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline gap-2">
                <span className="flex-1 truncate text-sm font-medium">
                  {conversation.title}
                </span>
                {conversation.pinned && (
                  <Pin
                    className={cn(
                      'size-2.5 shrink-0',
                      active ? 'text-white/70' : 'text-muted-foreground',
                    )}
                  />
                )}
                <span
                  className={cn(
                    'shrink-0 text-[10px]',
                    active ? 'text-white/70' : 'text-muted-foreground',
                  )}
                >
                  {conversation.time}
                </span>
              </span>
              <span className="mt-px flex items-center gap-1.5">
                <span
                  className={cn(
                    'flex-1 truncate text-xs',
                    active ? 'text-white/75' : 'text-muted-foreground',
                  )}
                >
                  {last?.text}
                </span>
                {conversation.unread && (
                  <span className="size-1.5 shrink-0 rounded-full bg-info" />
                )}
              </span>
            </span>
          </button>
        }
      />
      <ContextMenuContent className="w-52">
        <ContextMenuItem>
          <Pencil /> Rename
        </ContextMenuItem>
        <ContextMenuItem>
          <Pin /> {conversation.pinned ? 'Unpin' : 'Pin'}
        </ContextMenuItem>
        <ContextMenuItem>
          <CheckCircle2 /> Mark as {conversation.unread ? 'read' : 'unread'}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem>
          <MessageCircle /> New conversation with {bot.name}
        </ContextMenuItem>
        <ContextMenuItem>
          <FolderPlus /> Add to section…
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem>
          <Copy /> Copy conversation ID
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" onClick={onDelete}>
          <Trash2 /> Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
