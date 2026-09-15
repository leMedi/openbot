import { useEffect, useMemo, useRef, useState } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import type { Agent, ConversationMessage, Group } from '@openbot/db'
import { CalendarClock, MessageCircle, PanelRight } from 'lucide-react'
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
import { MobileStack } from '@/components/openbot/mobile-stack'
import { NewConversation } from '@/components/openbot/new-conversation'
import { AppOnboarding } from '@/components/openbot/app-onboarding'
import { GroupInspector, MobileGroupMembers } from '@/components/openbot/group-inspector'
import { YOU } from '@/components/conversation/data'
import {
  ClearConversationDialog,
  RenameConversationDialog,
} from '@/components/openbot/modals'
import { PluginsDialog } from '@/components/openbot/plugins-dialog'
import { mcpOauthErrorMessage } from '@/lib/mcp-oauth-error'
import { RoutinesDialog } from '@/components/openbot/routines-dialog'
import { SettingsDialog } from '@/components/openbot/settings-dialog'
import { Sidebar } from '@/components/openbot/sidebar'
import { Button } from '@/components/ui/button'
import { useIsMobile } from '@/hooks/use-is-mobile'
import { addAgent, getAgents } from '@/server/agents'
import { getAiProviders } from '@/server/providers'
import { addGroup, getGroups } from '@/server/groups'
import { getMcpConfiguration } from '@/server/mcp'
import { getUserProfile } from '@/server/profile'
import {
  cancelConversationTurn,
  getConversationMessages,
  respondToConversationTurn,
  sendConversationMessage,
  toggleConversationReaction,
} from '@/server/messages'
import {
  clearConversation,
  getConversations,
  renameConversation,
  setConversationUnread,
} from '@/server/conversations'
import { getDesktopMode } from '@/server/config'
import {
  getConversationSubagents,
  steerAgentSubagent,
  stopAgentSubagent,
} from '@/server/subagents'

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
    const [agents, groups, conversations, mcp, profile, providers, desktopMode] = await Promise.all([
      getAgents(),
      getGroups(),
      getConversations(),
      getMcpConfiguration(),
      getUserProfile(),
      getAiProviders(),
      getDesktopMode(),
    ])
    return { agents, groups, conversations, mcp, profile, providers, desktopMode }
  },
  component: OpenBot,
})

function OpenBot() {
  const {
    agents,
    groups,
    conversations: conversationRows,
    mcp,
    profile,
    providers,
    desktopMode,
  } = Route.useLoaderData()
  const router = useRouter()
  const isMobile = useIsMobile()

  const [activeId, setActiveId] = useState(conversationRows[0]?.id ?? '')
  // Phone navigation stack: the list page is home; a selected conversation
  // is pushed on top and popped with the back chevron or an edge swipe.
  const [mobileDetail, setMobileDetail] = useState(false)
  const [inspectorOpen, setInspectorOpen] = useState(true)
  const [newConversationOpen, setNewConversationOpen] = useState(false)
  const [mobileGroupMembersOpen, setMobileGroupMembersOpen] = useState(false)

  function openConversation(id: string) {
    setNewConversationOpen(false)
    setMobileGroupMembersOpen(false)
    setActiveId(id)
    setMobileDetail(true)
  }

  function openNewConversation() {
    setNewConversationOpen(true)
    setMobileDetail(true)
  }

  const [pluginsOpen, setPluginsOpen] = useState(false)
  const [pluginsError, setPluginsError] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [routinesOpen, setRoutinesOpen] = useState(false)
  const [updateAvailable, setUpdateAvailable] = useState(false)
  const [botDialog, setBotDialog] = useState<{ open: boolean; agent: Agent | null }>({
    open: false,
    agent: null,
  })
  const [groupDialog, setGroupDialog] = useState<{ open: boolean; group: Group | null }>({
    open: false,
    group: null,
  })
  const [deleteGroupTarget, setDeleteGroupTarget] = useState<Group | null>(null)
  const [renameTarget, setRenameTarget] = useState<BotConversation | null>(null)
  const [clearTarget, setClearTarget] = useState<BotConversation | null>(null)

  useEffect(() => {
    const url = new URL(window.location.href)
    const result = url.searchParams.get('mcpOAuth')
    if (!result) return
    if (result !== 'resumed') {
      setPluginsError(
        result === 'error'
          ? mcpOauthErrorMessage(url.searchParams.get('mcpOAuthError'))
          : '',
      )
      setPluginsOpen(true)
    }
    url.searchParams.delete('mcpOAuth')
    url.searchParams.delete('mcpOAuthError')
    window.history.replaceState(null, '', url)
  }, [])

  const agentBots = useMemo(
    () => agents.map((agent) => botFromAgent(agent, providers.setting.defaultAgentModel)),
    [agents, providers.setting.defaultAgentModel],
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
  const sidebarGroupAvatars = useMemo(
    () => Object.fromEntries(groups.map((group) => [
      group.id,
      [
        { ...YOU, name: profile.firstName || YOU.name, shape: '' },
        ...groupMemberIds(group)
          .map((id) => agentBots.find((agent) => agent.id === id))
          .filter((agent): agent is Bot => !!agent),
      ],
    ])),
    [agentBots, groups, profile.firstName],
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

  // Scheduled turns have no composer-known turn id. A global stream refreshes
  // their delivery conversation when a routine emits or settles.
  useEffect(() => {
    const source = new EventSource('/api/routines/stream')
    source.onmessage = (message) => {
      try {
        const event = JSON.parse(message.data) as { conversationId?: string }
        if (event.conversationId === activeId) {
          void getConversationMessages({ data: { conversationId: activeId } })
            .then(({ rows, pendingTurnId }) => {
              setTranscript({ conversationId: activeId, rows, pendingTurnId })
            })
        }
        void router.invalidate()
      } catch { /* Ignore malformed live updates. */ }
    }
    return () => source.close()
  }, [activeId, router])

  const findConversation = (id: string) =>
    conversations.find((c) => c.id === id) ?? null

  const active = conversations.find((c) => c.id === activeId)
  const bot = active ? botIn(bots, active.botId) : undefined
  const activeAgent = active
    ? agents.find((a) => a.id === active.botId)
    : undefined
  const mainAgent = active?.isMainAgentConversation ? activeAgent : undefined
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
  const groupHeaderAvatars = useMemo(() => {
    if (!activeGroup) return undefined
    return [
      { ...YOU, name: profile.firstName || YOU.name },
      ...(memberAuthors ?? []),
    ]
  }, [activeGroup, memberAuthors, profile.firstName])
  const activeGroupMembers = useMemo(
    () => activeGroup
      ? groupMemberIds(activeGroup)
          .map((id) => agentBots.find((agent) => agent.id === id))
          .filter((agent): agent is Bot => !!agent)
      : [],
    [activeGroup, agentBots],
  )

  function openAgentMainConversation(agentId: string) {
    const conversation = conversationRows.find(
      (row) => row.ownerAgentId === agentId && row.origin === 'agent-main',
    )
    if (conversation) void selectConversation(conversation.id)
  }
  const transcriptAuthorsById = useMemo(() => {
    const authors = new Map(
      agentBots.map((agentBot) => [agentBot.id, authorFromBot(agentBot)]),
    )
    for (const member of memberAuthors ?? []) authors.set(member.id, member)
    return authors
  }, [agentBots, memberAuthors])

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
      entries: entriesFromMessages(transcript.rows, author, transcriptAuthorsById),
      tabs: activityFromMessages(transcript.rows, author),
    }
  }, [active, bot, transcript, transcriptReady, transcriptAuthorsById])

  async function selectConversation(id: string) {
    openConversation(id)
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
      setMobileDetail(false)
    }
  }

  async function handleAgentDeleted(agentId: string) {
    const deletedConversationIds = new Set(
      conversationRows
        .filter((conversation) => conversation.ownerAgentId === agentId)
        .map((conversation) => conversation.id),
    )
    const activeWasDeleted = deletedConversationIds.has(activeId)
    await router.invalidate()
    if (!activeWasDeleted) return

    const next = conversations.find(
      (conversation) => !deletedConversationIds.has(conversation.id),
    )
    setTranscript(null)
    setActiveId(next?.id ?? '')
    setMobileDetail(false)
    if (!next) localStorage.removeItem(LAST_CONVERSATION_KEY)
  }

  async function createAgentFromConversation(name: string) {
    const created = await addAgent({ data: { name } })
    await router.invalidate()
    openConversation(created.conversation.id)
  }

  async function createGroupFromConversation(agentIds: string[], name: string) {
    const created = await addGroup({
      data: {
        name,
        members: agentIds.map((agentId) => ({ type: 'agent' as const, agentId })),
      },
    })
    await router.invalidate()
    openConversation(created.conversation.id)
  }

  const sidebar = (
    <Sidebar
      mobile={isMobile}
      conversations={conversations}
      bots={bots}
      groupAvatars={sidebarGroupAvatars}
      activeId={newConversationOpen ? '' : active?.id ?? ''}
      onSelect={selectConversation}
      onNewConversation={openNewConversation}
      onEditGroup={openEditGroup}
      onDeleteGroup={(groupId) =>
        setDeleteGroupTarget(groups.find((g) => g.id === groupId) ?? null)
      }
      onOpenPlugins={() => setPluginsOpen(true)}
      onOpenSettings={() => setSettingsOpen(true)}
      updateAvailable={updateAvailable}
      onRenameConversation={(id) => setRenameTarget(findConversation(id))}
      onToggleUnread={toggleUnread}
      onClearConversation={(id) => setClearTarget(findConversation(id))}
    />
  )

  const groupMembersProps = activeGroup ? {
    group: activeGroup,
    members: activeGroupMembers,
    agents: agentBots,
    onOpenMember: openAgentMainConversation,
    onChanged: () => router.invalidate(),
  } : null

  const pane = mobileGroupMembersOpen && groupMembersProps ? (
    <MobileGroupMembers
      {...groupMembersProps}
      onBack={() => setMobileGroupMembersOpen(false)}
    />
  ) : newConversationOpen ? (
    <NewConversation
      agents={agentBots}
      firstName={profile.firstName}
      mobile={isMobile}
      onBack={() => {
        setNewConversationOpen(false)
        setMobileDetail(false)
      }}
      onCreateAgent={createAgentFromConversation}
      onCreateGroup={createGroupFromConversation}
    />
  ) : active && bot && !transcriptReady ? (
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
        mentionAgents={agents}
        title={active.title}
        members={memberAuthors}
        headerAvatars={groupHeaderAvatars}
        resolveAuthor={(message) =>
          authorForMessage(message, authorFromBot(bot), transcriptAuthorsById)
        }
        initialEntries={entries}
        activityTabs={tabs}
        pendingTurnId={transcriptReady ? transcript?.pendingTurnId : null}
        desktopAgentId={
          desktopMode === 'per-agent' && mainAgent?.xDisplayNumber != null
            ? mainAgent.id
            : undefined
        }
        onSendMessage={(draft) =>
          sendConversationMessage({
            data: {
              conversationId: active.id,
              text: draft.prompt,
              // The server drops references it cannot resolve (e.g. an
              // optimistic local id), degrading to a plain message.
              replyToEntryId: draft.replyToId ?? null,
              attachments: draft.attachments.map((attachment) => ({
                name: attachment.name,
                mediaType: attachment.mediaType ?? 'application/octet-stream',
                data: attachment.data ?? '',
              })),
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
          return entriesFromMessages(
            refreshed.rows,
            authorFromBot(bot),
            transcriptAuthorsById,
          )
        }}
        onCancelTurn={(turnId) => cancelConversationTurn({ data: { turnId } })}
        onTurnSettled={async () => {
          // The assistant message advanced the sequence counter; the user
          // is looking at it, so move the read horizon and refresh the
          // sidebar ordering.
          await setConversationUnread({ data: { id: active.id, unread: false } })
          await router.invalidate()
        }}
        onListSubagents={() => getConversationSubagents({
          data: {
            conversationId: active.id,
            includeSettled: false,
          },
        })}
        onSteerSubagent={(subagentId, message) => steerAgentSubagent({
          data: {
            conversationId: active.id,
            subagentId,
            message,
            requestId: crypto.randomUUID(),
          },
        })}
        onStopSubagent={(subagentId) => stopAgentSubagent({
          data: {
            conversationId: active.id,
            subagentId,
          },
        })}
        onEditAgent={
          mainAgent
            ? () => setBotDialog({ open: true, agent: mainAgent })
            : undefined
        }
        onRenameTitle={async (title) => {
          await renameConversation({ data: { id: active.id, title } })
          await router.invalidate()
        }}
        onBack={isMobile ? () => setMobileDetail(false) : undefined}
        headerActions={
          isMobile ? (
            mainAgent ? (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Manage routines"
                onClick={() => setRoutinesOpen(true)}
              >
                <CalendarClock className="size-4" />
              </Button>
            ) : activeGroup ? (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Manage group members"
                onClick={() => setMobileGroupMembersOpen(true)}
              >
                <PanelRight className="size-4" />
              </Button>
            ) : undefined
          ) : mainAgent || activeGroup ? (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={activeGroup ? 'Toggle group members' : 'Toggle inspector'}
              onClick={() => setInspectorOpen((v) => !v)}
            >
              <PanelRight className="size-4" />
            </Button>
          ) : undefined
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
                : 'Create a group chat and add one or more bots.'}
            </p>
          </div>
          <Button size="sm" onClick={openNewConversation}>New conversation</Button>
        </div>
      </div>
    )

  return (
    <div className="flex h-svh overflow-hidden pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
      {isMobile ? (
        <MobileStack
          showDetail={mobileDetail && (!!active || newConversationOpen)}
          onBack={() => {
            setNewConversationOpen(false)
            setMobileDetail(false)
          }}
          list={sidebar}
          detail={pane}
        />
      ) : (
        <>
          {sidebar}
          {pane}
          {!newConversationOpen && inspectorOpen && active && bot && mainAgent && (
            <Inspector
              conversation={active}
              bot={bot}
              activeAgentId={mainAgent.id}
              desktopEnabled={desktopMode === 'per-agent' && mainAgent.xDisplayNumber != null}
              onOpenPlugins={() => setPluginsOpen(true)}
              onOpenRoutines={() => setRoutinesOpen(true)}
              mcpServers={mcp.servers}
              mcpAccounts={mcp.accounts}
              mcpGrants={mcp.grants}
            />
          )}
          {!newConversationOpen && inspectorOpen && activeGroup && groupMembersProps && (
            <GroupInspector {...groupMembersProps} />
          )}
        </>
      )}

      <PluginsDialog
        open={pluginsOpen}
        onOpenChange={(open) => {
          setPluginsOpen(open)
          if (!open) setPluginsError('')
        }}
        servers={mcp.servers}
        accounts={mcp.accounts}
        initialError={pluginsError}
        onChanged={() => router.invalidate()}
      />
      {!profile.onboardingCompleted && (
        <AppOnboarding
          profile={profile}
          providerConfiguration={providers}
          onComplete={() => router.invalidate()}
        />
      )}
      {mainAgent && active && (
        <RoutinesDialog
          open={routinesOpen}
          onOpenChange={setRoutinesOpen}
          agentId={mainAgent.id}
          conversationId={active.id}
          defaultTimezone={profile.timezone}
        />
      )}
      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        profile={profile}
        onProfileSaved={() => router.invalidate()}
        providerConfiguration={providers}
        onProvidersChanged={() => void router.invalidate()}
        onServerUpdateStatus={setUpdateAvailable}
        onDataCleared={async (firstConversationId) => {
          localStorage.removeItem(LAST_CONVERSATION_KEY)
          setTranscript(null)
          setActiveId(firstConversationId ?? '')
          setMobileDetail(false)
          await router.invalidate()
        }}
      />
      {groupDialog.open && (
        <GroupDialog
          open={groupDialog.open}
          onOpenChange={(open) => setGroupDialog((s) => ({ ...s, open }))}
          group={groupDialog.group}
          agents={agentBots}
          onSaved={async (_saved, sharedConversation) => {
            await router.invalidate()
            if (sharedConversation) openConversation(sharedConversation.id)
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
          models={providers.models}
          defaultAgentModel={providers.setting.defaultAgentModel}
          mcpServers={mcp.servers}
          mcpAccounts={mcp.accounts}
          grantedAccountIds={mcp.grants
            .filter((grant) => grant.agentId === botDialog.agent?.id)
            .map((grant) => grant.accountId)}
          onOpenPlugins={() => setPluginsOpen(true)}
          onSaved={async (_saved, firstConversation) => {
            await router.invalidate()
            if (firstConversation) openConversation(firstConversation.id)
          }}
          onDeleted={handleAgentDeleted}
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
    </div>
  )
}
