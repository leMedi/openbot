import { useEffect, useRef, useState } from 'react'
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
import { desktopReconnectDelay, instrumentDesktopLiveness } from './desktop-liveness'

type DesktopConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'error'

const desktopConnectionLabels: Record<DesktopConnectionState, string> = {
  connecting: 'Connecting',
  connected: 'Connected',
  reconnecting: 'Reconnecting',
  disconnected: 'Disconnected',
  error: 'Connection failed',
}

type ClipboardRfbInternals = {
  _sock: object
  _clipboardServerCapabilitiesFormats: Record<number, boolean>
  _clipboardServerCapabilitiesActions: Record<number, boolean>
}

type ClipboardRfbMessages = {
  extendedClipboardProvide: (socket: object, ...args: unknown[]) => unknown
}

const clipboardProvideWaiters = new WeakMap<ClipboardRfbMessages, {
  original: ClipboardRfbMessages['extendedClipboardProvide']
  waiters: Map<object, Set<() => void>>
}>()

function waitForClipboardProvide(messages: ClipboardRfbMessages, socket: object) {
  let state = clipboardProvideWaiters.get(messages)
  if (!state) {
    const original = messages.extendedClipboardProvide
    state = { original, waiters: new Map() }
    clipboardProvideWaiters.set(messages, state)
    messages.extendedClipboardProvide = function (providedSocket, ...args) {
      const result = original.call(this, providedSocket, ...args)
      const current = clipboardProvideWaiters.get(messages)
      const matching = current?.waiters.get(providedSocket)
      if (matching) for (const finish of [...matching]) finish()
      return result
    }
  }

  const activeState = state
  const promise = new Promise<void>((resolve) => {
    let settled = false
    let timeout: number | undefined
    const finish = () => {
      if (settled) return
      settled = true
      window.clearTimeout(timeout)
      const current = clipboardProvideWaiters.get(messages)
      const socketWaiters = current?.waiters.get(socket)
      socketWaiters?.delete(finish)
      if (socketWaiters?.size === 0) current?.waiters.delete(socket)
      if (current?.waiters.size === 0) {
        messages.extendedClipboardProvide = current.original
        clipboardProvideWaiters.delete(messages)
      }
      resolve()
    }
    const socketWaiters = activeState.waiters.get(socket) ?? new Set()
    socketWaiters.add(finish)
    activeState.waiters.set(socket, socketWaiters)
    timeout = window.setTimeout(finish, 2_000)
  })
  return promise
}

function pasteRfbClipboard(rfb: RfbClient, RFB: typeof RfbClient, text: string) {
  const internals = rfb as RfbClient & ClipboardRfbInternals
  const messages = (RFB as unknown as { messages: ClipboardRfbMessages }).messages
  const usesExtendedClipboard = internals._clipboardServerCapabilitiesFormats[1]
    && internals._clipboardServerCapabilitiesActions[1 << 27]
  const provided = usesExtendedClipboard
    ? waitForClipboardProvide(messages, internals._sock)
    : Promise.resolve()
  rfb.clipboardPasteFrom(text)
  return provided
}

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
  const [desktopConnection, setDesktopConnection] = useState<DesktopConnectionState>('disconnected')
  const [viewerPresent, setViewerPresent] = useState(false)

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
          <span className={`size-1.5 rounded-full ${desktopConnection === 'connected' ? 'bg-success' : desktopConnection === 'reconnecting' || desktopConnection === 'connecting' ? 'bg-warning' : 'bg-muted-foreground/40'}`} />
          <span className="text-xs text-muted-foreground">
            {desktopOpen
              ? `${desktopConnectionLabels[desktopConnection]} · ${viewerPresent ? 'local operator active' : 'local operator away'}`
              : 'Local viewer closed'}
          </span>
        </div>
        <DesktopDialog
          open={desktopOpen}
          onOpenChange={(nextOpen) => {
            setDesktopOpen(nextOpen)
            if (!nextOpen) {
              setDesktopConnection('disconnected')
              setViewerPresent(false)
            }
          }}
          agentId={activeAgentId}
          title={conversation.title}
          onConnectionChange={setDesktopConnection}
          onPresenceChange={setViewerPresent}
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
  onConnectionChange,
  onPresenceChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  agentId: string
  title: string
  onConnectionChange: (connection: DesktopConnectionState) => void
  onPresenceChange: (present: boolean) => void
}) {
  const [viewerElement, setViewerElement] = useState<HTMLDivElement | null>(null)
  const [connection, setConnection] = useState<DesktopConnectionState>('connecting')
  const [connectionMessage, setConnectionMessage] = useState<string | null>(null)
  const [liveness, setLiveness] = useState<'checking' | 'healthy' | 'stalled'>('checking')
  const [clipboardAccess, setClipboardAccess] = useState<'checking' | 'active' | 'shortcut-only'>('checking')
  const [remoteClipboardText, setRemoteClipboardText] = useState('')
  const [viewerPresent, setViewerPresent] = useState(false)
  const [connectionAttempt, setConnectionAttempt] = useState(0)
  const reconnectAttempt = useRef(0)

  useEffect(() => {
    if (open) return
    reconnectAttempt.current = 0
    setViewerPresent(false)
    setRemoteClipboardText('')
    onPresenceChange(false)
  }, [open, onPresenceChange])

  useEffect(() => {
    if (!open || !viewerElement) return
    let lastPresence: boolean | null = null
    const reportPresence = (present: boolean) => {
      if (lastPresence === present) return
      lastPresence = present
      setViewerPresent(present)
      onPresenceChange(present)
    }
    const onPresent = () => reportPresence(true)
    const onAway = () => reportPresence(false)
    const onFocusOut = (event: FocusEvent) => {
      if (!(event.relatedTarget instanceof Node) || !viewerElement.contains(event.relatedTarget)) {
        reportPresence(false)
      }
    }
    const onVisibilityChange = () => reportPresence(document.visibilityState === 'visible'
      && viewerElement.matches(':hover'))

    reportPresence(false)
    viewerElement.addEventListener('pointerenter', onPresent)
    viewerElement.addEventListener('pointerleave', onAway)
    viewerElement.addEventListener('pointermove', onPresent, { passive: true })
    viewerElement.addEventListener('keydown', onPresent, true)
    viewerElement.addEventListener('focusin', onPresent)
    viewerElement.addEventListener('focusout', onFocusOut)
    window.addEventListener('blur', onAway)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      viewerElement.removeEventListener('pointerenter', onPresent)
      viewerElement.removeEventListener('pointerleave', onAway)
      viewerElement.removeEventListener('pointermove', onPresent)
      viewerElement.removeEventListener('keydown', onPresent, true)
      viewerElement.removeEventListener('focusin', onPresent)
      viewerElement.removeEventListener('focusout', onFocusOut)
      window.removeEventListener('blur', onAway)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      reportPresence(false)
    }
  }, [open, viewerElement, onPresenceChange])

  useEffect(() => {
    if (!open || !viewerElement) return
    let disposed = false
    let terminalFailure = false
    let connected = false
    let retryScheduled = false
    let attemptExpired = false
    let rfb: RfbClient | undefined
    let removeClipboardHandlers: (() => void) | undefined
    let livenessInstrumentation: ReturnType<typeof instrumentDesktopLiveness> | undefined
    let removeRfbHandlers: (() => void) | undefined
    let retryTimer: number | undefined

    const updateConnection = (next: DesktopConnectionState, message: string | null = null) => {
      if (disposed) return
      setConnection(next)
      setConnectionMessage(message)
      onConnectionChange(next)
    }
    const detachInteraction = () => {
      removeClipboardHandlers?.()
      removeClipboardHandlers = undefined
      livenessInstrumentation?.dispose()
      livenessInstrumentation = undefined
    }
    const startNextAttempt = () => {
      if (disposed) return
      retryScheduled = true
      setConnectionAttempt((attempt) => attempt + 1)
    }
    const scheduleReconnect = (message: string) => {
      if (disposed || terminalFailure || retryScheduled) return
      connected = false
      attemptExpired = true
      detachInteraction()
      setLiveness('checking')
      window.clearTimeout(connectionTimeout)
      if (!navigator.onLine) {
        retryScheduled = true
        updateConnection('reconnecting', 'Waiting for network access')
        return
      }
      retryScheduled = true
      const delay = desktopReconnectDelay(++reconnectAttempt.current)
      updateConnection('reconnecting', `${message} Retrying in ${Math.ceil(delay / 1_000)}s.`)
      retryTimer = window.setTimeout(startNextAttempt, delay)
    }
    const fail = (message: string) => {
      if (disposed || terminalFailure) return
      terminalFailure = true
      connected = false
      window.clearTimeout(connectionTimeout)
      window.clearTimeout(retryTimer)
      detachInteraction()
      setLiveness('checking')
      updateConnection('error', message)
    }
    updateConnection(reconnectAttempt.current > 0 ? 'reconnecting' : 'connecting')
    setLiveness('checking')
    const connectionTimeout = window.setTimeout(() => {
      scheduleReconnect('The desktop did not connect within 15 seconds.')
      rfb?.disconnect()
    }, 15_000)
    const onOffline = () => {
      if (disposed || terminalFailure) return
      connected = false
      attemptExpired = true
      retryScheduled = true
      window.clearTimeout(connectionTimeout)
      window.clearTimeout(retryTimer)
      detachInteraction()
      setLiveness('checking')
      updateConnection('reconnecting', 'Waiting for network access')
      rfb?.disconnect()
    }
    const onOnline = () => {
      if (disposed || terminalFailure || connected) return
      window.clearTimeout(retryTimer)
      startNextAttempt()
    }
    window.addEventListener('offline', onOffline)
    window.addEventListener('online', onOnline)

    void import('@novnc/novnc').then(({ default: RFB }) => {
      if (disposed || terminalFailure || attemptExpired) return
      // The WebSocket endpoint is server-owned; the browser never receives a VNC port.
      const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws'
      rfb = new RFB(viewerElement, `${scheme}://${window.location.host}/api/agents/${encodeURIComponent(agentId)}/desktop/vnc`)
      rfb.scaleViewport = true
      rfb.resizeSession = false
      rfb.viewOnly = false
      const canvas = viewerElement.querySelector('canvas')
      canvas?.setAttribute('aria-label', 'Remote agent desktop')
      if (viewerElement === document.activeElement) rfb.focus()
      const browserClipboard = window.isSecureContext && 'clipboard' in navigator
        ? navigator.clipboard
        : undefined
      setClipboardAccess(browserClipboard ? 'checking' : 'shortcut-only')
      const clipboard = createDesktopClipboardController({
        isMac: /Mac/i.test(navigator.platform ?? ''),
        rfb: {
          sendKey: (...args) => rfb?.sendKey(...args),
          clipboardPasteFrom: (text) => pasteRfbClipboard(rfb as RfbClient, RFB, text),
        },
        readClipboard: browserClipboard ? () => browserClipboard.readText() : undefined,
        writeClipboard: browserClipboard
          ? (text) => browserClipboard.writeText(text)
          : async () => { throw new Error('Clipboard API unavailable') },
        onClipboardAccess: (available) => setClipboardAccess(available ? 'active' : 'shortcut-only'),
        onRemoteClipboard: setRemoteClipboardText,
      })
      const onKeyDown = (event: KeyboardEvent) => clipboard.keyDown(event)
      const onKeyUp = (event: KeyboardEvent) => clipboard.keyUp(event)
      const onPointerDown = () => { void clipboard.pointerDown() }
      const onFocus = () => { void clipboard.syncHostClipboard() }
      const onVisibilityChange = () => {
        if (document.visibilityState === 'visible') void clipboard.syncHostClipboard()
      }
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
      window.addEventListener('focus', onFocus)
      document.addEventListener('visibilitychange', onVisibilityChange)
      rfb.addEventListener('clipboard', onClipboard)
      removeClipboardHandlers = () => {
        clipboard.release()
        viewerElement.removeEventListener('keydown', onKeyDown, true)
        viewerElement.removeEventListener('keyup', onKeyUp, true)
        viewerElement.removeEventListener('pointerdown', onPointerDown, true)
        window.removeEventListener('paste', onPaste, true)
        window.removeEventListener('blur', onBlur)
        window.removeEventListener('focus', onFocus)
        document.removeEventListener('visibilitychange', onVisibilityChange)
        rfb?.removeEventListener('clipboard', onClipboard)
      }
      livenessInstrumentation = instrumentDesktopLiveness({
        rfb,
        viewer: viewerElement,
        isConnected: () => connected,
        onStall: (report) => {
          setLiveness('stalled')
          console.warn('[desktop liveness]', report)
        },
        onRecovery: () => setLiveness('healthy'),
      })
      const onConnect = () => {
        if (disposed || terminalFailure) return
        connected = true
        retryScheduled = false
        reconnectAttempt.current = 0
        window.clearTimeout(connectionTimeout)
        window.clearTimeout(retryTimer)
        updateConnection('connected')
        setLiveness('healthy')
        livenessInstrumentation?.connected()
        void clipboard.syncHostClipboard()
      }
      const onDisconnect = (event: CustomEvent<{ clean: boolean }>) => {
        scheduleReconnect(event.detail.clean
          ? 'The desktop connection closed.'
          : 'The desktop connection was interrupted.')
      }
      const onSecurityFailure = (event: CustomEvent<{ reason?: string }>) => {
        fail(event.detail.reason ?? 'The desktop rejected the connection')
      }
      rfb.addEventListener('connect', onConnect)
      rfb.addEventListener('disconnect', onDisconnect)
      rfb.addEventListener('securityfailure', onSecurityFailure)
      removeRfbHandlers = () => {
        rfb?.removeEventListener('connect', onConnect)
        rfb?.removeEventListener('disconnect', onDisconnect)
        rfb?.removeEventListener('securityfailure', onSecurityFailure)
      }
    }).catch((cause) => {
      fail(cause instanceof Error ? cause.message : 'Could not initialize the desktop viewer')
    })
    return () => {
      disposed = true
      window.clearTimeout(connectionTimeout)
      window.clearTimeout(retryTimer)
      window.removeEventListener('offline', onOffline)
      window.removeEventListener('online', onOnline)
      detachInteraction()
      removeRfbHandlers?.()
      rfb?.disconnect()
    }
  }, [open, agentId, viewerElement, connectionAttempt, onConnectionChange])

  const retryNow = () => {
    reconnectAttempt.current = 0
    setConnectionAttempt((attempt) => attempt + 1)
  }

  const copyRemoteClipboardText = async () => {
    if (!remoteClipboardText) return
    try {
      if (window.isSecureContext && 'clipboard' in navigator) {
        await navigator.clipboard.writeText(remoteClipboardText)
        setClipboardAccess('active')
        return
      }
    } catch { /* Fall back to a user-activated document copy. */ }
    const textarea = document.createElement('textarea')
    textarea.value = remoteClipboardText
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.append(textarea)
    textarea.select()
    document.execCommand('copy')
    textarea.remove()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[90vh] w-[95vw] max-w-none flex-col sm:max-w-none">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 pr-8">
            <span className="flex-1">Live View · {title}</span>
            <span className="flex items-center gap-1.5 text-xs font-normal text-muted-foreground">
              <span className={`size-1.5 rounded-full ${connection === 'connected' ? 'bg-success' : connection === 'connecting' || connection === 'reconnecting' ? 'bg-warning' : 'bg-destructive'}`} />
              {desktopConnectionLabels[connection]}
            </span>
          </DialogTitle>
        </DialogHeader>
        <div
          ref={setViewerElement}
          className="min-h-0 flex-1 overflow-hidden rounded-lg bg-black outline-none focus-within:ring-2 focus-within:ring-ring focus-visible:ring-2 focus-visible:ring-ring"
          tabIndex={0}
          aria-label="Interactive agent desktop"
          onFocus={(event) => {
            if (event.target !== event.currentTarget) return
            const canvas = event.currentTarget.querySelector('canvas')
            canvas?.setAttribute('aria-label', 'Remote agent desktop')
            canvas?.focus()
          }}
        />
        <div className="flex min-h-6 items-center justify-center gap-3 text-xs" aria-live="polite">
          <span className="text-muted-foreground">{viewerPresent ? 'Local operator active' : 'Local operator away'}</span>
          <span className="text-muted-foreground">
            Clipboard {clipboardAccess === 'active' ? 'sync active' : clipboardAccess === 'checking' ? 'sync checking' : 'access restricted'}
          </span>
          {clipboardAccess === 'shortcut-only' && remoteClipboardText && (
            <Button size="xs" variant="outline" onClick={() => void copyRemoteClipboardText()}>Copy remote text</Button>
          )}
          {connectionMessage && <span className={connection === 'error' ? 'text-destructive' : 'text-muted-foreground'}>{connectionMessage}</span>}
          {connection === 'connected' && liveness === 'stalled' && <span className="text-warning">Desktop may be unresponsive</span>}
          {connection === 'connected' && liveness !== 'stalled' && <span className="text-muted-foreground">Session responsive</span>}
          {(connection === 'error' || connection === 'reconnecting' || liveness === 'stalled') && (
            <Button size="xs" variant="outline" onClick={retryNow}>Retry now</Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
