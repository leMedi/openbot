import { useRef, useState } from 'react'
import {
  ArrowUp,
  BotIcon,
  CheckCircle2,
  Copy,
  Eraser,
  FolderPlus,
  MessageCircle,
  Pencil,
  Pin,
  Plug,
  Plus,
  Search,
  Settings,
  Trash2,
  Users,
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
import { botIn, type Bot, type Conversation } from './data'

// Drag the right border to resize; below SNAP_AT it snaps to the
// avatar-only rail (COLLAPSED_W), otherwise clamps to [MIN_W, MAX_W].
const COLLAPSED_W = 64
const SNAP_AT = 140
const MIN_W = 200
const MAX_W = 420
const DEFAULT_W = 256

type SidebarProps = {
  conversations: Conversation[]
  bots: Bot[]
  activeId: string
  onSelect: (id: string) => void
  onNewBot: () => void
  onNewConversation: () => void
  onNewGroup: () => void
  onNewConversationWith: (botId: string) => void
  onEditGroup: (groupId: string) => void
  onDeleteGroup: (groupId: string) => void
  onOpenPlugins: () => void
  onOpenSettings: () => void
  onRenameConversation: (id: string) => void
  onToggleUnread: (id: string) => void
  onClearConversation: (id: string) => void
  onDeleteConversation: (id: string) => void
}

export function Sidebar({
  conversations,
  bots,
  activeId,
  onSelect,
  onNewBot,
  onNewConversation,
  onNewGroup,
  onNewConversationWith,
  onEditGroup,
  onDeleteGroup,
  onOpenPlugins,
  onOpenSettings,
  onRenameConversation,
  onToggleUnread,
  onClearConversation,
  onDeleteConversation,
}: SidebarProps) {
  const [search, setSearch] = useState('')
  const [width, setWidth] = useState(DEFAULT_W)
  const [resizing, setResizing] = useState(false)
  const asideRef = useRef<HTMLElement>(null)

  const collapsed = width < SNAP_AT

  function startResize(e: React.PointerEvent) {
    e.preventDefault()
    const left = asideRef.current?.getBoundingClientRect().left ?? 0
    setResizing(true)
    const onMove = (ev: PointerEvent) => {
      setWidth(Math.max(COLLAPSED_W, Math.min(MAX_W, ev.clientX - left)))
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      setResizing(false)
      setWidth((w) => (w < SNAP_AT ? COLLAPSED_W : Math.max(MIN_W, w)))
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const filtered = conversations.filter((c) =>
    (c.title + botIn(bots, c.botId).name).toLowerCase().includes(search.toLowerCase()),
  )
  const pinned = filtered.filter((c) => c.pinned)
  const rest = filtered.filter((c) => !c.pinned)
  const ordered = [...pinned, ...rest]

  const plusMenu = (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size="icon-sm" aria-label="New…">
            <Plus className="size-3.5" />
          </Button>
        }
      />
      <DropdownMenuContent align={collapsed ? 'start' : 'end'} className="w-44">
        <DropdownMenuItem onClick={onNewBot}>
          <BotIcon /> New Bot
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onNewConversation}>
          <MessageCircle /> New Conversation
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onNewGroup}>
          <Users /> New Group
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )

  return (
    <aside
      ref={asideRef}
      className="relative flex shrink-0 flex-col border-r bg-sidebar"
      style={{ width, transition: resizing ? 'none' : 'width .15s ease' }}
    >
      <div
        onPointerDown={startResize}
        title="Drag to resize"
        className="absolute top-0 -right-1 z-30 h-full w-2 cursor-col-resize"
      />

      {collapsed ? (
        <>
          <div className="flex justify-center pt-2.5 pb-1">{plusMenu}</div>
          <div className="flex flex-1 flex-col items-center gap-1 overflow-y-auto py-1">
            {ordered.map((c) => {
              const bot = botIn(bots, c.botId)
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => onSelect(c.id)}
                  title={`${c.title} — ${bot.name}`}
                  className={cn(
                    'relative flex size-10 shrink-0 items-center justify-center rounded-lg',
                    c.id === activeId ? 'bg-primary/25' : 'hover:bg-muted',
                  )}
                >
                  <BotAvatar name={bot.name} color={bot.color} shape={bot.shape} src={bot.avatarUrl} />
                  {c.unread && (
                    <span className="absolute top-1 right-1 size-1.5 rounded-full bg-info" />
                  )}
                </button>
              )
            })}
          </div>
          <div className="flex flex-col items-center gap-1 border-t py-2">
            <Button variant="ghost" size="icon-sm" aria-label="Plugins" onClick={onOpenPlugins}>
              <Plug className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Settings"
              onClick={onOpenSettings}
              className="relative"
            >
              <Settings className="size-4" />
              <span
                title="Upgrade available"
                className="absolute top-0.5 right-0.5 size-2 rounded-full border border-sidebar bg-primary"
              />
            </Button>
          </div>
        </>
      ) : (
        <>
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
            {plusMenu}
          </div>

          <div className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-2 pb-2">
            {pinned.length > 0 && (
              <div className="px-2 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-muted-foreground">
                Pinned
              </div>
            )}
            {ordered.map((c) => (
              <ConversationRow
                key={c.id}
                conversation={c}
                bot={botIn(bots, c.botId)}
                active={c.id === activeId}
                onSelect={() => onSelect(c.id)}
                onNewConversationWith={onNewConversationWith}
                onEditGroup={onEditGroup}
                onDeleteGroup={onDeleteGroup}
                onRename={() => onRenameConversation(c.id)}
                onToggleUnread={() => onToggleUnread(c.id)}
                onClear={() => onClearConversation(c.id)}
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
        </>
      )}
    </aside>
  )
}

function ConversationRow({
  conversation,
  bot,
  active,
  onSelect,
  onNewConversationWith,
  onEditGroup,
  onDeleteGroup,
  onRename,
  onToggleUnread,
  onClear,
  onDelete,
}: {
  conversation: Conversation
  bot: Bot
  active: boolean
  onSelect: () => void
  onNewConversationWith: (botId: string) => void
  onEditGroup: (groupId: string) => void
  onDeleteGroup: (groupId: string) => void
  onRename: () => void
  onToggleUnread: () => void
  onClear: () => void
  onDelete: () => void
}) {
  const isGroup = bot.kind === 'group'
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
            <BotAvatar name={bot.name} color={bot.color} shape={bot.shape} src={bot.avatarUrl} />
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
        <ContextMenuItem onClick={onRename}>
          <Pencil /> Rename
        </ContextMenuItem>
        <ContextMenuItem>
          <Pin /> {conversation.pinned ? 'Unpin' : 'Pin'}
        </ContextMenuItem>
        <ContextMenuItem onClick={onToggleUnread}>
          <CheckCircle2 /> Mark as {conversation.unread ? 'read' : 'unread'}
        </ContextMenuItem>
        <ContextMenuSeparator />
        {isGroup ? (
          <ContextMenuItem onClick={() => onEditGroup(bot.id)}>
            <Users /> Edit group
          </ContextMenuItem>
        ) : (
          <ContextMenuItem onClick={() => onNewConversationWith(bot.id)}>
            <MessageCircle /> New conversation with {bot.name}
          </ContextMenuItem>
        )}
        <ContextMenuItem>
          <FolderPlus /> Add to section…
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          onClick={() => navigator.clipboard.writeText(conversation.id)}
        >
          <Copy /> Copy conversation ID
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={onClear}>
          <Eraser /> Clear history
        </ContextMenuItem>
        {/* A group's room is its only conversation; deleting it deletes the group. */}
        <ContextMenuItem
          variant="destructive"
          onClick={isGroup ? () => onDeleteGroup(bot.id) : onDelete}
        >
          <Trash2 /> {isGroup ? 'Delete group' : 'Delete'}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
