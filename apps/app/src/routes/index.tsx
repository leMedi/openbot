import { useEffect, useMemo, useRef, useState } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import type { Agent, ConversationMessage, Group } from '@openbot/db'
import { BotIcon, MessageCircle, PanelRight } from 'lucide-react'
import {
  activityFromMessages,
  authorForMessage,
  entriesFromMessages,
} from '@/components/conversation/adapter'
import { Conversation } from '@/components/conversation/conversation'
import type { Author } from '@/components/conversation/types'
import { botFromAgent } from '@/components/openbot/agents'
import { BotDialog } from '@/components/openbot/bot-dialog'
import { conversationFromRow } from '@/components/openbot/conversations'
import { botIn, type Bot, type Conversation as BotConversation } from '@/components/openbot/data'
import { DeleteGroupDialog, GroupDialog } from '@/components/openbot/group-dialog'
import { botFromGroup, groupMemberIds } from '@/components/openbot/groups'
import { Inspector } from '@/components/openbot/inspector'
import {
  ClearConversationDialog,
  DeleteConversationDialog,
  NewConversationDialog,
  RenameConversationDialog,
} from '@/components/openbot/modals'
import { PluginsDialog } from '@/components/openbot/plugins-dialog'
import { SettingsDialog } from '@/components/openbot/settings-dialog'
import { Sidebar } from '@/components/openbot/sidebar'
import { Button } from '@/components/ui/button'
import { getAgents } from '@/server/agents'
import { getServerConfig } from '@/server/config'
import { getGroups } from '@/server/groups'
import { getMcpConfiguration } from '@/server/mcp'
import {
  cancelConversationTurn,
  getConversationMessages,
  respondToConversationTurn,
  sendConversationMessage,
  toggleConversationReaction,
} from '@/server/messages'
import {
  addConversation,
  clearConversation,
  getConversations,
  removeConversation,
  renameConversation,
  setConversationUnread,
} from '@/server/conversations'

function authorFromBot(bot: Bot, kind: 'agent' | 'member' = 'agent'): Author {
  return {
    id: bot.id,
    name: bot.name,
    color: bot.color,
    shape: bot.shape,
    avatarUrl: bot.avatarUrl,
    kind,
  }
}

// Client-local navigation preference, deliberately not server domain state.
const LAST_CONVERSATION_KEY = 'openbot:last-conversation'

export const Route = createFileRoute('/')({
  loader: async () => {
    const [agents, groups, conversations, config, mcp] = await Promise.all([
      getAgents(),
      getGroups(),
      getConversations(),
      getServerConfig(),
      getMcpConfiguration(),
    ])
    return { agents, groups, conversations, config, mcp }
  },
  component: OpenBot,
})

function OpenBot() {
  const { agents, groups, conversations: conversationRows, config, mcp } = Route.useLoaderData()
  const router = useRouter()

  const [activeId, setActiveId] = useState(conversationRows[0]?.id ?? '')
  const [inspectorOpen, setInspectorOpen] = useState(true)

  const [pluginsOpen, setPluginsOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [newConvoOpen, setNewConvoOpen] = useState(false)
  const [botDialog, setBotDialog] = useState<{ open: boolean; agent: Agent | null }>({
    open: false,
    agent: null,
  })
  const [groupDialog, setGroupDialog] = useState<{ open: boolean; group: Group | null }>({
    open: false,
    group: null,
  })
  const [deleteGroupTarget, setDeleteGroupTarget] = useState<Group | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<BotConversation | null>(null)
  const [renameTarget, setRenameTarget] = useState<BotConversation | null>(null)
  const [clearTarget, setClearTarget] = useState<BotConversation | null>(null)

  useEffect(() => {
    const url = new URL(window.location.href)
    if (!url.searchParams.has('mcpOAuth')) return
    setPluginsOpen(true)
    url.searchParams.delete('mcpOAuth')
    window.history.replaceState(null, '', url)
  }, [])

  const agentBots = useMemo(
    () => agents.map((agent) => botFromAgent(agent, config.model)),
    [agents, config.model],
  )
  // One combined view-model list: sidebar rows resolve their owner (agent or
  // group room) through the same lookup.
  const bots = useMemo(
    () => [...agentBots, ...groups.map(botFromGroup)],
    [agentBots, groups],
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
  const activeGroup = active
    ? groups.find((g) => g.id === active.botId)
    : undefined
  // Group rooms: member identities in membership order, for the composed
  // header avatar and per-message author attribution.
  const memberAuthors = useMemo(() => {
    if (!activeGroup) return undefined
    return groupMemberIds(activeGroup)
      .map((id) => agentBots.find((b) => b.id === id))
      .filter((b): b is Bot => !!b)
      .map((b) => authorFromBot(b, 'member'))
  }, [activeGroup, agentBots])
  const membersById = useMemo(
    () => memberAuthors && new Map(memberAuthors.map((a) => [a.id, a])),
    [memberAuthors],
  )

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
    const author = authorFromBot(bot)
    return {
      entries: entriesFromMessages(transcript.rows, author, membersById),
      tabs: activityFromMessages(transcript.rows, author),
    }
  }, [active, bot, transcript, transcriptReady, membersById])

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

  function openEditGroup(groupId: string) {
    const target = groups.find((g) => g.id === groupId)
    if (target) setGroupDialog({ open: true, group: target })
  }

  async function handleGroupDeleted(result: { conversationId: string | null }) {
    setDeleteGroupTarget(null)
    await router.invalidate()
    if (result.conversationId && result.conversationId === activeId) {
      const next = conversations.find((c) => c.id !== result.conversationId)
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
        onNewGroup={() => setGroupDialog({ open: true, group: null })}
        onNewConversationWith={startConversation}
        onEditGroup={openEditGroup}
        onDeleteGroup={(groupId) =>
          setDeleteGroupTarget(groups.find((g) => g.id === groupId) ?? null)
        }
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
          agent={authorFromBot(bot)}
          title={active.title}
          model={bot.model}
          members={memberAuthors}
          resolveAuthor={(message) =>
            authorForMessage(message, authorFromBot(bot), membersById)
          }
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
                requestId: crypto.randomUUID(),
                idempotencyKey: draft.idempotencyKey ?? crypto.randomUUID(),
              },
            })
          }
          onRespondToTurn={({
            turnId,
            text,
            optionId,
            dismissed,
            toolCallId,
            requestId,
            idempotencyKey,
          }) =>
            respondToConversationTurn({
              data: {
                turnId,
                text,
                optionId,
                dismissed,
                toolCallId,
                requestId,
                idempotencyKey,
              },
            })
          }
          onToggleReaction={(messageId, reaction) =>
            toggleConversationReaction({
              data: { conversationId: active.id, messageId, reaction },
            })
          }
          onRefreshEntries={async () => {
            const refreshed = await getConversationMessages({
              data: { conversationId: active.id },
            })
            return entriesFromMessages(refreshed.rows, authorFromBot(bot), membersById)
          }}
          onCancelTurn={(turnId) => cancelConversationTurn({ data: { turnId } })}
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
              : activeGroup
                ? () => setGroupDialog({ open: true, group: activeGroup })
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
        <Inspector
          conversation={active}
          bot={bot}
          activeAgentId={activeAgent?.id}
          onOpenPlugins={() => setPluginsOpen(true)}
          mcpServers={mcp.servers}
          mcpAccounts={mcp.accounts}
          mcpGrants={mcp.grants}
        />
      )}

      <PluginsDialog
        open={pluginsOpen}
        onOpenChange={setPluginsOpen}
        servers={mcp.servers}
        accounts={mcp.accounts}
        onChanged={() => router.invalidate()}
      />
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      <NewConversationDialog
        open={newConvoOpen}
        onOpenChange={setNewConvoOpen}
        onPick={startConversation}
        bots={agentBots}
      />
      {groupDialog.open && (
        <GroupDialog
          open={groupDialog.open}
          onOpenChange={(open) => setGroupDialog((s) => ({ ...s, open }))}
          group={groupDialog.group}
          agents={agentBots}
          onSaved={async (_saved, sharedConversation) => {
            await router.invalidate()
            if (sharedConversation) setActiveId(sharedConversation.id)
          }}
        />
      )}
      <DeleteGroupDialog
        group={deleteGroupTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteGroupTarget(null)
        }}
        onDeleted={handleGroupDeleted}
      />
      {botDialog.open && (
        <BotDialog
          open={botDialog.open}
          onOpenChange={(open) => setBotDialog((s) => ({ ...s, open }))}
          agent={botDialog.agent}
          serverModel={config.model}
          mcpServers={mcp.servers}
          mcpAccounts={mcp.accounts}
          grantedAccountIds={mcp.grants
            .filter((grant) => grant.agentId === botDialog.agent?.id)
            .map((grant) => grant.accountId)}
          onOpenPlugins={() => setPluginsOpen(true)}
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
