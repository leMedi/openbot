import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { BotDialog } from '@/components/openbot/bot-dialog'
import { Chat } from '@/components/openbot/chat'
import { botById, CONVERSATIONS, type Bot, type Conversation } from '@/components/openbot/data'
import { Inspector } from '@/components/openbot/inspector'
import {
  DeleteConversationDialog,
  NewChannelDialog,
  NewConversationDialog,
} from '@/components/openbot/modals'
import { PluginsDialog } from '@/components/openbot/plugins-dialog'
import { SettingsDialog } from '@/components/openbot/settings-dialog'
import { Sidebar } from '@/components/openbot/sidebar'

export const Route = createFileRoute('/')({
  component: OpenBot,
})

function OpenBot() {
  const [conversations, setConversations] = useState<Conversation[]>(CONVERSATIONS)
  const [activeId, setActiveId] = useState('c1')
  const [openThreadId, setOpenThreadId] = useState<string | null>(null)
  const [inspectorOpen, setInspectorOpen] = useState(true)

  const [pluginsOpen, setPluginsOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [newConvoOpen, setNewConvoOpen] = useState(false)
  const [newChannelOpen, setNewChannelOpen] = useState(false)
  const [botDialog, setBotDialog] = useState<{ open: boolean; bot: Bot | null }>({
    open: false,
    bot: null,
  })
  const [deleteTarget, setDeleteTarget] = useState<Conversation | null>(null)

  const active = conversations.find((c) => c.id === activeId) ?? conversations[0]
  const bot = botById(active.botId)

  function selectConversation(id: string) {
    setActiveId(id)
    setOpenThreadId(null)
    setConversations((all) => all.map((c) => (c.id === id ? { ...c, unread: false } : c)))
  }

  function startConversation(botId: string) {
    const picked = botById(botId)
    const convo: Conversation = {
      id: `c${Date.now()}`,
      botId,
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
        activeId={active.id}
        onSelect={selectConversation}
        onNewBot={() => setBotDialog({ open: true, bot: null })}
        onNewConversation={() => setNewConvoOpen(true)}
        onNewChannel={() => setNewChannelOpen(true)}
        onOpenPlugins={() => setPluginsOpen(true)}
        onOpenSettings={() => setSettingsOpen(true)}
        onDeleteConversation={(id) =>
          setDeleteTarget(conversations.find((c) => c.id === id) ?? null)
        }
      />

      <Chat
        key={active.id}
        conversation={active}
        openThreadId={openThreadId}
        onOpenThread={setOpenThreadId}
        onToggleInspector={() => setInspectorOpen((v) => !v)}
        onEditBot={(b) => setBotDialog({ open: true, bot: b })}
      />

      {inspectorOpen && (
        <Inspector
          conversation={active}
          bot={bot}
          onOpenPlugins={() => setPluginsOpen(true)}
        />
      )}

      <PluginsDialog open={pluginsOpen} onOpenChange={setPluginsOpen} />
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      <NewConversationDialog
        open={newConvoOpen}
        onOpenChange={setNewConvoOpen}
        onPick={startConversation}
      />
      <NewChannelDialog open={newChannelOpen} onOpenChange={setNewChannelOpen} />
      {botDialog.open && (
        <BotDialog
          open={botDialog.open}
          onOpenChange={(open) => setBotDialog((s) => ({ ...s, open }))}
          bot={botDialog.bot}
        />
      )}
      <DeleteConversationDialog
        conversation={deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
        onConfirm={deleteConversation}
      />
    </div>
  )
}
