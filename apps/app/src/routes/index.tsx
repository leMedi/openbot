import { useEffect, useMemo, useRef, useState } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import type { Agent, ConversationMessage } from '@openbot/db'
import { BotIcon, MessageCircle, PanelRight } from 'lucide-react'
import {
  activityFromMessages,
  entriesFromMessages,
} from '@/components/conversation/adapter'
import { Conversation } from '@/components/conversation/conversation'
import { botFromAgent } from '@/components/openbot/agents'
import { BotDialog } from '@/components/openbot/bot-dialog'
import { conversationFromRow } from '@/components/openbot/conversations'
import { botIn, type Conversation as BotConversation } from '@/components/openbot/data'
import { Inspector } from '@/components/openbot/inspector'
import {
  ClearConversationDialog,
  DeleteConversationDialog,
  NewChannelDialog,
  NewConversationDialog,
  RenameConversationDialog,
} from '@/components/openbot/modals'
import { PluginsDialog } from '@/components/openbot/plugins-dialog'
import { SettingsDialog } from '@/components/openbot/settings-dialog'
import { Sidebar } from '@/components/openbot/sidebar'
import { Button } from '@/components/ui/button'
import { getAgents } from '@/server/agents'
import { getServerConfig } from '@/server/config'
import {
  getConversationMessages,
  sendConversationMessage,
} from '@/server/messages'
import {
  addConversation,
  clearConversation,
  getConversations,
  removeConversation,
  renameConversation,
  setConversationUnread,
} from '@/server/conversations'

// Client-local navigation preference, deliberately not server domain state.
const LAST_CONVERSATION_KEY = 'openbot:last-conversation'

export const Route = createFileRoute('/')({
  loader: async () => {
    const [agents, conversations, config] = await Promise.all([
      getAgents(),
      getConversations(),
      getServerConfig(),
    ])
    return { agents, conversations, config }
  },
  component: OpenBot,
})

function OpenBot() {
  const { agents, conversations: conversationRows, config } = Route.useLoaderData()
  const router = useRouter()

  const [activeId, setActiveId] = useState(conversationRows[0]?.id ?? '')
  const [inspectorOpen, setInspectorOpen] = useState(true)

  const [pluginsOpen, setPluginsOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [newConvoOpen, setNewConvoOpen] = useState(false)
  const [newChannelOpen, setNewChannelOpen] = useState(false)
  const [botDialog, setBotDialog] = useState<{ open: boolean; agent: Agent | null }>({
    open: false,
    agent: null,
  })
  const [deleteTarget, setDeleteTarget] = useState<BotConversation | null>(null)
  const [renameTarget, setRenameTarget] = useState<BotConversation | null>(null)
  const [clearTarget, setClearTarget] = useState<BotConversation | null>(null)

  const bots = useMemo(
    () => agents.map((agent) => botFromAgent(agent, config.model)),
    [agents, config.model],
  )
  const conversations = useMemo(
    () => conversationRows.map(conversationFromRow),
    [conversationRows],
  )

  // Restore the last selected conversation after mount; localStorage is
  // unavailable during server rendering.
  useEffect(() => {
    const saved = localStorage.getItem(LAST_CONVERSATION_KEY)
    if (saved && conversationRows.some((c) => c.id === saved)) setActiveId(saved)
    // Run once on mount: restoring again after loader refreshes would fight
    // in-session selection changes.
  }, [])

  // Skip the mount run so the default selection never overwrites the saved
  // value before the restore effect above has been applied.
  const selectionRestored = useRef(false)
  useEffect(() => {
    if (!selectionRestored.current) {
      selectionRestored.current = true
      return
    }
    if (activeId) localStorage.setItem(LAST_CONVERSATION_KEY, activeId)
  }, [activeId])

  const findConversation = (id: string) =>
    conversations.find((c) => c.id === id) ?? null

  const active = conversations.find((c) => c.id === activeId)
  const bot = active ? botIn(bots, active.botId) : undefined
  const activeAgent = active
    ? agents.find((a) => a.id === active.botId)
    : undefined

  // The persisted transcript for the selected conversation. Loaded on
  // selection rather than in the route loader because the active id is a
  // client-local preference.
  const [transcript, setTranscript] = useState<{
    conversationId: string
    rows: ConversationMessage[]
    pendingTurnId: string | null
  } | null>(null)
  useEffect(() => {
    if (!activeId) return
    let cancelled = false
    getConversationMessages({ data: { conversationId: activeId } })
      .then(({ rows, pendingTurnId }) => {
        if (!cancelled) setTranscript({ conversationId: activeId, rows, pendingTurnId })
      })
      .catch(() => {
        if (!cancelled) {
          setTranscript({ conversationId: activeId, rows: [], pendingTurnId: null })
        }
      })
    return () => {
      cancelled = true
    }
  }, [activeId])
  const transcriptReady = transcript?.conversationId === active?.id

  const { entries, tabs } = useMemo(() => {
    if (!active || !bot || !transcript || transcript.conversationId !== active.id) {
      return { entries: [], tabs: [] }
    }
    const author = {
      id: bot.id,
      name: bot.name,
      color: bot.color,
      shape: bot.shape,
      avatarUrl: bot.avatarUrl,
      kind: 'agent' as const,
    }
    return {
      entries: entriesFromMessages(transcript.rows, author),
      tabs: activityFromMessages(transcript.rows, author),
    }
  }, [active, bot, transcript, transcriptReady])

  async function startConversation(botId: string) {
    const picked = botIn(bots, botId)
    const created = await addConversation({
      data: {
        agentId: picked.id,
        title: `New conversation with ${picked.name}`,
        origin: 'user',
      },
    })
    setNewConvoOpen(false)
    await router.invalidate()
    setActiveId(created.id)
  }

  async function selectConversation(id: string) {
    setActiveId(id)
    const picked = findConversation(id)
    if (picked?.unread) {
      await setConversationUnread({ data: { id, unread: false } })
      await router.invalidate()
    }
  }

  async function toggleUnread(id: string) {
    const target = findConversation(id)
    if (!target) return
    await setConversationUnread({ data: { id, unread: !target.unread } })
    await router.invalidate()
  }

  async function submitRename(title: string) {
    if (!renameTarget) return
    await renameConversation({ data: { id: renameTarget.id, title } })
    setRenameTarget(null)
    await router.invalidate()
  }

  async function confirmClearConversation() {
    if (!clearTarget) return
    const fresh = await clearConversation({ data: { id: clearTarget.id } })
    const wasActive = clearTarget.id === activeId
    setClearTarget(null)
    await router.invalidate()
    if (wasActive) setActiveId(fresh.id)
  }

  async function deleteConversation() {
    if (!deleteTarget) return
    await removeConversation({ data: { id: deleteTarget.id } })
    setDeleteTarget(null)
    await router.invalidate()
    if (deleteTarget.id === activeId) {
      const next = conversations.find((c) => c.id !== deleteTarget.id)
      setActiveId(next?.id ?? '')
    }
  }

  return (
    <div className="flex h-svh overflow-hidden">
      <Sidebar
        conversations={conversations}
        bots={bots}
        activeId={active?.id ?? ''}
        onSelect={selectConversation}
        onNewBot={() => setBotDialog({ open: true, agent: null })}
        onNewConversation={() => setNewConvoOpen(true)}
        onNewChannel={() => setNewChannelOpen(true)}
        onNewConversationWith={startConversation}
        onOpenPlugins={() => setPluginsOpen(true)}
        onOpenSettings={() => setSettingsOpen(true)}
        onRenameConversation={(id) => setRenameTarget(findConversation(id))}
        onToggleUnread={toggleUnread}
        onClearConversation={(id) => setClearTarget(findConversation(id))}
        onDeleteConversation={(id) => setDeleteTarget(findConversation(id))}
      />

      {active && bot && !transcriptReady ? (
        // The Conversation component seeds its entry state from
        // initialEntries at mount, so wait for the persisted transcript.
        <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
          Loading conversation…
        </div>
      ) : active && bot ? (
        <Conversation
          key={active.id}
          id={active.id}
          agent={{
            id: bot.id,
            name: bot.name,
            color: bot.color,
            shape: bot.shape,
            avatarUrl: bot.avatarUrl,
            kind: 'agent',
          }}
          title={active.title}
          model={bot.model}
          initialEntries={entries}
          activityTabs={tabs}
          pendingTurnId={transcriptReady ? transcript?.pendingTurnId : null}
          onSendMessage={(draft) =>
            sendConversationMessage({
              data: {
                conversationId: active.id,
                text: draft.prompt,
                // The server drops references it cannot resolve (e.g. an
                // optimistic local id), degrading to a plain message.
                replyToEntryId: draft.replyToId ?? null,
              },
            })
          }
          onTurnSettled={async () => {
            // The assistant message advanced the sequence counter; the user
            // is looking at it, so move the read horizon and refresh the
            // sidebar ordering.
            await setConversationUnread({ data: { id: active.id, unread: false } })
            await router.invalidate()
          }}
          onEditAgent={
            activeAgent
              ? () => setBotDialog({ open: true, agent: activeAgent })
              : undefined
          }
          headerActions={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Toggle inspector"
              onClick={() => setInspectorOpen((v) => !v)}
            >
              <PanelRight className="size-4" />
            </Button>
          }
        />
      ) : (
        <div className="flex flex-1 items-center justify-center">
          <div className="flex flex-col items-center gap-3 text-center">
            <MessageCircle className="size-8 text-muted-foreground/40" />
            <div>
              <div className="text-sm font-medium">No conversations yet</div>
              <p className="mt-1 text-xs text-muted-foreground">
                {agents.length === 0
                  ? 'Create a bot to get started.'
                  : 'Start a conversation with one of your bots.'}
              </p>
            </div>
            {agents.length === 0 ? (
              <Button size="sm" onClick={() => setBotDialog({ open: true, agent: null })}>
                <BotIcon className="size-3.5" /> New Bot
              </Button>
            ) : (
              <Button size="sm" onClick={() => setNewConvoOpen(true)}>
                <MessageCircle className="size-3.5" /> New Conversation
              </Button>
            )}
          </div>
        </div>
      )}

      {inspectorOpen && active && bot && (
        <Inspector conversation={active} bot={bot} onOpenPlugins={() => setPluginsOpen(true)} />
      )}

      <PluginsDialog open={pluginsOpen} onOpenChange={setPluginsOpen} />
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      <NewConversationDialog
        open={newConvoOpen}
        onOpenChange={setNewConvoOpen}
        onPick={startConversation}
        bots={bots}
      />
      <NewChannelDialog open={newChannelOpen} onOpenChange={setNewChannelOpen} bots={bots} />
      {botDialog.open && (
        <BotDialog
          open={botDialog.open}
          onOpenChange={(open) => setBotDialog((s) => ({ ...s, open }))}
          agent={botDialog.agent}
          serverModel={config.model}
          onSaved={async (_saved, firstConversation) => {
            await router.invalidate()
            if (firstConversation) setActiveId(firstConversation.id)
          }}
        />
      )}
      <RenameConversationDialog
        conversation={renameTarget}
        onOpenChange={(open) => {
          if (!open) setRenameTarget(null)
        }}
        onSubmit={submitRename}
      />
      <ClearConversationDialog
        conversation={clearTarget}
        onOpenChange={(open) => {
          if (!open) setClearTarget(null)
        }}
        onConfirm={confirmClearConversation}
        bots={bots}
      />
      <DeleteConversationDialog
        conversation={deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
        onConfirm={deleteConversation}
        bots={bots}
      />
    </div>
  )
}
