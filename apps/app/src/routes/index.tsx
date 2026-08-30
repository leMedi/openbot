import { useMemo, useState } from 'react'
import type { Agent } from '@openbot/db'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { PanelRight } from 'lucide-react'
import { activityFor, entriesFor } from '@/components/conversation/adapter'
import { Conversation } from '@/components/conversation/conversation'
import { ACTIVITY_TABS, INITIAL_ENTRIES, MEMBERS } from '@/components/conversation/data'
import { botFromAgent } from '@/components/openbot/agents'
import { BotDialog } from '@/components/openbot/bot-dialog'
import {
  botIn,
  BOTS,
  CONVERSATIONS,
  type Conversation as BotConversation,
} from '@/components/openbot/data'
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

  const [conversations, setConversations] = useState<BotConversation[]>(CONVERSATIONS)
  const [activeId, setActiveId] = useState('c1')
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

  // Persisted agents come first; the mock showcase bots remain until the
  // conversation slices replace them.
  const bots = useMemo(() => [...agents.map(botFromAgent), ...BOTS], [agents])

  const active = conversations.find((c) => c.id === activeId) ?? conversations[0]
  const bot = botIn(bots, active.botId)
  // Editing is only offered for persisted agents; mock showcase bots have no
  // server-side profile to edit.
  const activeAgent = agents.find((a) => a.id === active.botId)

  // "Sprint 78 board sweep" carries the full showcase transcript; the rest are
  // adapted from the OpenBot mock data.
  const { entries, tabs, members } = useMemo(() => {
    if (active.id === 'c1') {
      return { entries: INITIAL_ENTRIES, tabs: ACTIVITY_TABS, members: MEMBERS }
    }
    return { entries: entriesFor(active), tabs: activityFor(active), members: undefined }
  }, [active])

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
      if (deleteTarget.id === activeId && next.length > 0) setActiveId(next[0].id)
      return next
    })
    setDeleteTarget(null)
  }

  return (
    <div className="flex h-svh overflow-hidden">
      <Sidebar
        conversations={conversations}
        bots={bots}
        activeId={active.id}
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

      <Conversation
        key={active.id}
        id={active.id}
        agent={{ id: bot.id, name: bot.name, color: bot.color, kind: 'agent' }}
        title={active.title}
        model={bot.model}
        members={members}
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

      {inspectorOpen && (
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
