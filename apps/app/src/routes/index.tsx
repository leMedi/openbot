import { useMemo, useState } from 'react'
import type { Agent } from '@openbot/db'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { BotIcon, MessageCircle, PanelRight } from 'lucide-react'
import { activityFor, entriesFor } from '@/components/conversation/adapter'
import { Conversation } from '@/components/conversation/conversation'
import { botFromAgent } from '@/components/openbot/agents'
import { BotDialog } from '@/components/openbot/bot-dialog'
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

export const Route = createFileRoute('/')({
  loader: () => getAgents(),
  component: OpenBot,
})

function OpenBot() {
  const agents = Route.useLoaderData()
  const router = useRouter()

  // Conversations are client-held until conversation persistence lands.
  const [conversations, setConversations] = useState<BotConversation[]>([])
  const [activeId, setActiveId] = useState('')
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

  const bots = useMemo(() => agents.map(botFromAgent), [agents])

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

  function selectConversation(id: string) {
    setActiveId(id)
    setConversations((all) => all.map((c) => (c.id === id ? { ...c, unread: false } : c)))
  }

  function startConversation(botId: string) {
    const picked = botIn(bots, botId)
    const convo: BotConversation = {
      id: `c${Date.now()}`,
      botId: picked.id,
      title: `New conversation with ${picked.name}`,
      time: 'Now',
      messages: [],
    }
    setConversations((all) => [convo, ...all])
    setNewConvoOpen(false)
    selectConversation(convo.id)
  }

  function deleteConversation() {
    if (!deleteTarget) return
    setConversations((all) => {
      const next = all.filter((c) => c.id !== deleteTarget.id)
      if (deleteTarget.id === activeId) setActiveId(next[0]?.id ?? '')
      return next
    })
    setDeleteTarget(null)
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
          onSaved={() => router.invalidate()}
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
