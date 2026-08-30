import { useMemo, useState } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import type { Agent } from '@openbot/db'
import { BotIcon, MessageCircle, PanelRight } from 'lucide-react'
import { activityFor, entriesFor } from '@/components/conversation/adapter'
import { Conversation } from '@/components/conversation/conversation'
import { botFromAgent } from '@/components/openbot/agents'
import { BotDialog } from '@/components/openbot/bot-dialog'
import { conversationFromRow } from '@/components/openbot/conversations'
import { botIn, type Conversation as BotConversation } from '@/components/openbot/data'
import { Inspector } from '@/components/openbot/inspector'
import {
  DeleteConversationDialog,
  NewChannelDialog,
  NewConversationDialog,
} from '@/components/openbot/modals'
import { PluginsDialog } from '@/components/openbot/plugins-dialog'
import { SettingsDialog } from '@/components/openbot/settings-dialog'
import { Sidebar } from '@/components/openbot/sidebar'
import { Button } from '@/components/ui/button'
import { getAgents } from '@/server/agents'
import { getServerConfig } from '@/server/config'
import {
  addConversation,
  getConversations,
  removeConversation,
} from '@/server/conversations'

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

  const bots = useMemo(
    () => agents.map((agent) => botFromAgent(agent, config.model)),
    [agents, config.model],
  )
  const conversations = useMemo(
    () => conversationRows.map(conversationFromRow),
    [conversationRows],
  )

  const active = conversations.find((c) => c.id === activeId)
  const bot = active ? botIn(bots, active.botId) : undefined
  const activeAgent = active
    ? agents.find((a) => a.id === active.botId)
    : undefined

  const { entries, tabs } = useMemo(() => {
    if (!active || !bot) return { entries: [], tabs: [] }
    const author = { id: bot.id, name: bot.name, color: bot.color, kind: 'agent' as const }
    return { entries: entriesFor(active, author), tabs: activityFor(active, author) }
  }, [active, bot])

  async function startConversation(botId: string) {
    const picked = botIn(bots, botId)
    const created = await addConversation({
      data: { agentId: picked.id, title: `New conversation with ${picked.name}` },
    })
    setNewConvoOpen(false)
    await router.invalidate()
    setActiveId(created.id)
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
        onSelect={setActiveId}
        onNewBot={() => setBotDialog({ open: true, agent: null })}
        onNewConversation={() => setNewConvoOpen(true)}
        onNewChannel={() => setNewChannelOpen(true)}
        onOpenPlugins={() => setPluginsOpen(true)}
        onOpenSettings={() => setSettingsOpen(true)}
        onDeleteConversation={(id) =>
          setDeleteTarget(conversations.find((c) => c.id === id) ?? null)
        }
      />

      {active && bot ? (
        <Conversation
          key={active.id}
          id={active.id}
          agent={{ id: bot.id, name: bot.name, color: bot.color, kind: 'agent' }}
          title={active.title}
          model={bot.model}
          initialEntries={entries}
          activityTabs={tabs}
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
