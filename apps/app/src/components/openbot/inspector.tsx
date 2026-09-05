import { useEffect, useState } from 'react'
import type RfbClient from '@novnc/novnc'
import type { MemoryItem, MemoryKind, SafeMcpAccount, SafeMcpServer } from '@openbot/db'
import { FileText, Maximize2, Pencil, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import {
  addMemoryItem,
  getMemoryItems,
  removeMemoryItem,
  updateMemory,
} from '@/server/memory'
import { BotAvatar } from './bot-avatar'
import type { Bot, Conversation } from './data'
import { createDesktopClipboardController } from './desktop-clipboard'

export function Inspector({
  conversation,
  bot,
  activeAgentId,
  desktopEnabled,
  onOpenPlugins,
  mcpServers,
  mcpAccounts,
  mcpGrants,
}: {
  conversation: Conversation
  bot: Bot
  activeAgentId?: string
  desktopEnabled: boolean
  onOpenPlugins: () => void
  mcpServers: SafeMcpServer[]
  mcpAccounts: SafeMcpAccount[]
  mcpGrants: { agentId: string; accountId: string; enabledAt: number }[]
}) {
  const [memoryOpen, setMemoryOpen] = useState(false)
  const [memoryItems, setMemoryItems] = useState<MemoryItem[]>([])
  const [memoryLoading, setMemoryLoading] = useState(true)
  const [memoryError, setMemoryError] = useState('')
  const [memorySaving, setMemorySaving] = useState(false)
  const [editingMemory, setEditingMemory] = useState<MemoryItem | null>(null)
  const [memoryScope, setMemoryScope] = useState<'user' | 'agent'>(
    activeAgentId ? 'agent' : 'user',
  )
  const [memoryKind, setMemoryKind] = useState<MemoryKind>('note')
  const [memoryDraft, setMemoryDraft] = useState('')
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [desktopOpen, setDesktopOpen] = useState(false)

  useEffect(() => {
    if (!activeAgentId || !desktopEnabled) return
    setPreviewUrl(null)
    let cancelled = false
    let objectUrl: string | null = null
    const refresh = async () => {
      try {
        const response = await fetch(`/api/agents/${encodeURIComponent(activeAgentId)}/desktop/screenshot`)
        if (!response.ok) return
        const next = URL.createObjectURL(await response.blob())
        if (cancelled) URL.revokeObjectURL(next)
        else {
          objectUrl && URL.revokeObjectURL(objectUrl)
          objectUrl = next
          setPreviewUrl(next)
        }
      } catch { /* The preview is best-effort. */ }
    }
    void refresh()
    const timer = window.setInterval(() => void refresh(), 2_000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [activeAgentId, desktopEnabled])

  async function readMemory() {
    const [shared, scoped] = await Promise.all([
      getMemoryItems({ data: { scope: 'user' } }),
      activeAgentId
        ? getMemoryItems({
            data: { scope: 'agent', subjectAgentId: activeAgentId },
          })
        : Promise.resolve([]),
    ])
    return [...shared, ...scoped]
  }

  useEffect(() => {
    let cancelled = false
    setEditingMemory(null)
    setMemoryScope(activeAgentId ? 'agent' : 'user')
    setMemoryKind('note')
    setMemoryDraft('')
    setMemoryLoading(true)
    setMemoryError('')
    readMemory()
      .then((items) => {
        if (!cancelled) setMemoryItems(items)
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setMemoryError(error instanceof Error ? error.message : 'Could not load memory')
        }
      })
      .finally(() => {
        if (!cancelled) setMemoryLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [activeAgentId])

  function resetMemoryDraft() {
    setEditingMemory(null)
    setMemoryScope(activeAgentId ? 'agent' : 'user')
    setMemoryKind('note')
    setMemoryDraft('')
  }

  function editMemory(item: MemoryItem) {
    setEditingMemory(item)
    setMemoryScope(item.scope === 'agent' ? 'agent' : 'user')
    setMemoryKind(item.kind as MemoryKind)
    setMemoryDraft(item.content)
  }

  function selectorFor(item: MemoryItem) {
    if (item.scope === 'user') return { id: item.id, scope: 'user' as const }
    if (!item.subjectAgentId) throw new Error(`Memory item ${item.id} has no subject`)
    return {
      id: item.id,
      scope: 'agent' as const,
      subjectAgentId: item.subjectAgentId,
    }
  }

  async function saveMemory() {
    const content = memoryDraft.trim()
    if (!content) return
    setMemorySaving(true)
    setMemoryError('')
    try {
      if (editingMemory) {
        await updateMemory({
          data: {
            selector: selectorFor(editingMemory),
            patch: { kind: memoryKind, content },
          },
        })
      } else if (memoryScope === 'agent' && activeAgentId) {
        await addMemoryItem({
          data: {
            scope: 'agent',
            subjectAgentId: activeAgentId,
            kind: memoryKind,
            content,
          },
        })
      } else {
        await addMemoryItem({
          data: { scope: 'user', kind: memoryKind, content },
        })
      }
      setMemoryItems(await readMemory())
      resetMemoryDraft()
    } catch (error) {
      setMemoryError(error instanceof Error ? error.message : 'Could not save memory')
    } finally {
      setMemorySaving(false)
    }
  }

  async function forgetMemory(item: MemoryItem) {
    if (!window.confirm(`Forget this ${item.kind} memory? This cannot be undone.`)) {
      return
    }
    setMemorySaving(true)
    setMemoryError('')
    try {
      await removeMemoryItem({ data: selectorFor(item) })
      setMemoryItems((items) => items.filter((candidate) => candidate.id !== item.id))
      if (editingMemory?.id === item.id) resetMemoryDraft()
    } catch (error) {
      setMemoryError(error instanceof Error ? error.message : 'Could not forget memory')
    } finally {
      setMemorySaving(false)
    }
  }

  const accounts = mcpGrants
    .filter((grant) => grant.agentId === activeAgentId)
    .map(({ accountId }) => {
      const account = mcpAccounts.find((candidate) => candidate.id === accountId)
      const server = mcpServers.find((candidate) => candidate.id === account?.serverId)
      return server && account ? { server, account } : null
    })
    .filter((x) => x !== null)

  return (
    <aside className="flex w-78 shrink-0 flex-col gap-5.5 overflow-y-auto border-l bg-sidebar/70 px-3.5 py-4">
      {/* Live view is only meaningful for an agent-owned display. */}
      {activeAgentId && desktopEnabled && (
      <section>
        <h3 className="mb-2 text-[11px] font-semibold text-muted-foreground">Live View</h3>
        <button
          type="button"
          onClick={() => setDesktopOpen(true)}
          className="group relative flex h-36 w-full cursor-zoom-in items-end overflow-hidden rounded-lg border bg-muted p-2.5 text-left hover:border-foreground/20"
          aria-label="Open full desktop control"
        >
          {previewUrl && <img src={previewUrl} alt="Current agent desktop" className="absolute inset-0 size-full object-cover" />}
          <span className="relative z-10 max-w-full truncate rounded-md bg-black/55 px-2 py-1 text-[10px] text-muted-foreground">
            {conversation.title} · screen
          </span>
          <Maximize2 className="absolute right-2 top-2 z-10 size-3.5 text-white opacity-0 drop-shadow group-hover:opacity-100" />
        </button>
        <div className="mt-2 flex items-center gap-1.5">
          <span className="size-1.5 rounded-full bg-success" />
          <span className="text-xs text-muted-foreground">Shared machine</span>
        </div>
        <DesktopDialog
          open={desktopOpen}
          onOpenChange={setDesktopOpen}
          agentId={activeAgentId}
          title={conversation.title}
        />
      </section>
      )}

      {/* Accounts */}
      <section>
        <div className="mb-2 flex items-center">
          <h3 className="flex-1 text-[11px] font-semibold text-muted-foreground">Accounts</h3>
          <button
            type="button"
            onClick={onOpenPlugins}
            className="text-xs font-medium text-info hover:opacity-80"
          >
            Manage
          </button>
        </div>
        {accounts.length > 0 ? (
          <div className="overflow-hidden rounded-lg border">
            {accounts.map(({ server, account }) => (
              <div
                key={account.id}
                className="flex items-center gap-2 border-b bg-card px-2.5 py-2 last:border-b-0"
              >
                <BotAvatar
                  name={server.name}
                  color="#3b82f6"
                  className="size-5 rounded-sm text-[9px]"
                />
                <span className="min-w-0 flex-1 truncate text-xs">{server.name}</span>
                <span className="text-[11px] text-muted-foreground">{account.label}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground/70">No accounts scoped to this bot.</p>
        )}
      </section>

      {/* Memory */}
      <section>
        <div className="mb-2 flex items-center">
          <h3 className="flex-1 text-[11px] font-semibold text-muted-foreground">Memory</h3>
          <button
            type="button"
            onClick={() => setMemoryOpen(true)}
            className="text-xs font-medium text-info hover:opacity-80"
          >
            View / Edit
          </button>
        </div>
        <button
          type="button"
          onClick={() => setMemoryOpen(true)}
          className="w-full rounded-lg border bg-card px-3 py-2.5 text-left hover:border-foreground/20"
        >
          <div className="mb-1.5 flex items-center gap-1.5">
            <FileText className="size-3 text-muted-foreground" />
            <span className="font-mono text-[11px] font-semibold text-foreground/80">
              DURABLE ITEMS
            </span>
          </div>
          <div className="line-clamp-4 text-[11px] leading-relaxed whitespace-pre-wrap text-muted-foreground">
            {memoryLoading
              ? 'Loading durable memory...'
              : memoryItems.length > 0
                ? memoryItems.map((item) => item.content).join('\n')
                : 'No durable memory yet.'}
          </div>
        </button>
        <p className="mt-1.5 text-[10px] leading-normal text-muted-foreground/70">
          Shared-user facts and memory scoped to this bot survive conversation clearing.
        </p>
      </section>

      <Dialog
        open={memoryOpen}
        onOpenChange={(open) => {
          setMemoryOpen(open)
          if (!open) resetMemoryDraft()
        }}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-baseline gap-2.5">
              <span className="flex-1">Durable Memory - {bot.name}</span>
              <span className="text-[10px] font-semibold tracking-wider text-muted-foreground/70">
                {memoryItems.length} ITEMS
              </span>
            </DialogTitle>
          </DialogHeader>
          <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
            {memoryLoading ? (
              <p className="py-8 text-center text-xs text-muted-foreground">Loading...</p>
            ) : memoryItems.length === 0 ? (
              <p className="rounded-lg border border-dashed py-8 text-center text-xs text-muted-foreground">
                No durable memory yet.
              </p>
            ) : (
              memoryItems.map((item) => (
                <div key={item.id} className="rounded-lg border bg-card p-3">
                  <div className="mb-1.5 flex items-center gap-2">
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground">
                      {item.kind}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      {item.scope === 'user' ? 'Shared user' : 'This bot'}
                      {' · '}
                      {item.authoredByAgentId
                        ? `Agent ${item.authoredByAgentId}`
                        : 'Author not recorded'}
                    </span>
                    <span className="flex-1" />
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label="Edit memory"
                      onClick={() => editMemory(item)}
                    >
                      <Pencil className="size-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label="Forget memory"
                      disabled={memorySaving}
                      onClick={() => void forgetMemory(item)}
                    >
                      <Trash2 className="size-3" />
                    </Button>
                  </div>
                  <p className="text-xs leading-relaxed whitespace-pre-wrap">{item.content}</p>
                </div>
              ))
            )}
          </div>

          <div className="rounded-lg border bg-muted/20 p-3">
            <div className="mb-2 flex items-center gap-2">
              <span className="text-xs font-medium">
                {editingMemory ? 'Edit memory' : 'Add memory'}
              </span>
              <span className="flex-1" />
              <select
                value={memoryScope}
                disabled={!!editingMemory}
                onChange={(event) =>
                  setMemoryScope(event.target.value as 'user' | 'agent')
                }
                className="h-7 rounded-md border bg-background px-2 text-xs disabled:opacity-60"
              >
                <option value="user">Shared user</option>
                {activeAgentId && <option value="agent">This bot</option>}
              </select>
              <select
                value={memoryKind}
                onChange={(event) => setMemoryKind(event.target.value as MemoryKind)}
                className="h-7 rounded-md border bg-background px-2 text-xs"
              >
                <option value="profile">Profile</option>
                <option value="log">Log</option>
                <option value="note">Note</option>
              </select>
            </div>
            <Textarea
              value={memoryDraft}
              onChange={(event) => setMemoryDraft(event.target.value)}
              placeholder="A durable fact with enough context to remain useful..."
              className="min-h-24 text-xs leading-relaxed"
            />
          </div>
          {memoryError && <p className="text-xs text-destructive">{memoryError}</p>}
          <DialogFooter className="items-center">
            <span className="mr-auto text-[11px] text-muted-foreground/70">
              Changes affect future turns.
            </span>
            {editingMemory && (
              <Button variant="secondary" size="sm" onClick={resetMemoryDraft}>
                Cancel edit
              </Button>
            )}
            <Button
              size="sm"
              disabled={memorySaving || !memoryDraft.trim()}
              onClick={() => void saveMemory()}
            >
              <Plus className="size-3.5" />
              {editingMemory ? 'Update' : 'Add'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </aside>
  )
}

function DesktopDialog({
  open,
  onOpenChange,
  agentId,
  title,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  agentId: string
  title: string
}) {
  const [viewerElement, setViewerElement] = useState<HTMLDivElement | null>(null)
  const [connection, setConnection] = useState<'connecting' | 'connected' | 'error'>('connecting')
  const [connectionError, setConnectionError] = useState<string | null>(null)
  const [connectionAttempt, setConnectionAttempt] = useState(0)

  useEffect(() => {
    if (!open || !viewerElement) return
    let disposed = false
    let failed = false
    let rfb: RfbClient | undefined
    let removeClipboardHandlers: (() => void) | undefined
    setConnection('connecting')
    setConnectionError(null)
    const fail = (message: string) => {
      if (disposed || failed) return
      failed = true
      window.clearTimeout(connectionTimeout)
      setConnection('error')
      setConnectionError(message)
    }
    const connectionTimeout = window.setTimeout(() => {
      fail('The desktop did not connect within 15 seconds')
      rfb?.disconnect()
    }, 15_000)
    void import('@novnc/novnc').then(({ default: RFB }) => {
      if (disposed || failed) return
      // The WebSocket endpoint is server-owned; the browser never receives a VNC port.
      const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws'
      rfb = new RFB(viewerElement, `${scheme}://${window.location.host}/api/agents/${encodeURIComponent(agentId)}/desktop/vnc`)
      const clipboard = createDesktopClipboardController({
        isMac: /Mac|iPhone|iPad/.test(navigator.platform ?? ''),
        rfb,
        writeClipboard: async (text) => navigator.clipboard?.writeText(text),
      })
      const onKeyDown = (event: KeyboardEvent) => clipboard.keyDown(event)
      const onKeyUp = (event: KeyboardEvent) => clipboard.keyUp(event)
      const onPointerDown = () => clipboard.pointerDown()
      const onPaste = (event: ClipboardEvent) => {
        const target = event.target
        const viewerFocused = target instanceof Node && viewerElement.contains(target)
          || viewerElement.contains(document.activeElement)
        if (!clipboard.hasPendingPaste() && !viewerFocused) return
        const text = event.clipboardData?.getData('text/plain')
        if (text === undefined) {
          clipboard.cancelPaste()
          return
        }
        clipboard.paste({
          text,
          preventDefault: () => event.preventDefault(),
          stopPropagation: () => event.stopPropagation(),
        })
      }
      const onClipboard = (event: CustomEvent<{ text: string }>) => {
        void clipboard.remoteClipboard(event.detail.text)
      }
      const onBlur = () => clipboard.release()
      viewerElement.addEventListener('keydown', onKeyDown, true)
      viewerElement.addEventListener('keyup', onKeyUp, true)
      viewerElement.addEventListener('pointerdown', onPointerDown, true)
      window.addEventListener('paste', onPaste, true)
      window.addEventListener('blur', onBlur)
      rfb.addEventListener('clipboard', onClipboard)
      removeClipboardHandlers = () => {
        clipboard.release()
        viewerElement.removeEventListener('keydown', onKeyDown, true)
        viewerElement.removeEventListener('keyup', onKeyUp, true)
        viewerElement.removeEventListener('pointerdown', onPointerDown, true)
        window.removeEventListener('paste', onPaste, true)
        window.removeEventListener('blur', onBlur)
        rfb?.removeEventListener('clipboard', onClipboard)
      }
      rfb.addEventListener('connect', () => {
        if (disposed || failed) return
        window.clearTimeout(connectionTimeout)
        setConnection('connected')
      })
      rfb.addEventListener('disconnect', () => {
        fail('The desktop connection closed')
      })
      rfb.addEventListener('securityfailure', (event) => {
        fail(event.detail.reason ?? 'The desktop rejected the connection')
      })
      rfb.scaleViewport = true
      rfb.resizeSession = false
      rfb.viewOnly = false
    }).catch((cause) => {
      fail(cause instanceof Error ? cause.message : 'Could not initialize the desktop viewer')
    })
    return () => {
      disposed = true
      window.clearTimeout(connectionTimeout)
      removeClipboardHandlers?.()
      rfb?.disconnect()
    }
  }, [open, agentId, viewerElement, connectionAttempt])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[90vh] w-[95vw] max-w-none flex-col sm:max-w-none">
        <DialogHeader><DialogTitle>Live View · {title}</DialogTitle></DialogHeader>
        <div ref={setViewerElement} className="min-h-0 flex-1 overflow-hidden rounded-lg bg-black" />
        {connection === 'connecting' && <p className="text-center text-xs text-muted-foreground">Connecting to desktop…</p>}
        {connection === 'error' && (
          <div className="flex items-center justify-center gap-3 text-xs text-destructive">
            <span>{connectionError}</span>
            <Button size="xs" variant="outline" onClick={() => setConnectionAttempt((attempt) => attempt + 1)}>Retry</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
