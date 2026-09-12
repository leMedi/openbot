import { useMemo, useRef, useState } from 'react'
import { BotIcon, ChevronLeft, Loader2, Plus, Users, X } from 'lucide-react'
import { BotAvatar } from './bot-avatar'
import type { Bot } from './data'
import { matchingConversationAgents, namedConversationGroup } from './new-conversation-model'

type Mode = 'single' | 'group'

export function NewConversation({
  agents,
  firstName,
  mobile,
  onBack,
  onCreateAgent,
  onCreateGroup,
}: {
  agents: Bot[]
  firstName: string
  mobile: boolean
  onBack: () => void
  onCreateAgent: (name: string) => Promise<void>
  onCreateGroup: (agentIds: string[], name: string) => Promise<void>
}) {
  const [mode, setMode] = useState<Mode>('single')
  const [query, setQuery] = useState('')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [highlighted, setHighlighted] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const selected = selectedIds.flatMap(
    (id) => agents.find((agent) => agent.id === id) ?? [],
  )
  const matches = useMemo(
    () => matchingConversationAgents(agents, selectedIds, query),
    [agents, selectedIds, query],
  )
  const name = query.trim()
  const fixedActionCount = mode === 'single' ? (name ? 1 : 2) : 0
  const resultCount = fixedActionCount + matches.length

  function updateQuery(value: string) {
    setQuery(value)
    setHighlighted(0)
    setError('')
  }

  async function runCreation(action: () => Promise<void>, fallback: string) {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await action()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : fallback)
      setBusy(false)
    }
  }

  function createAgent(agentName: string) {
    if (!agentName.trim()) return
    void runCreation(() => onCreateAgent(agentName.trim()), 'The agent could not be created')
  }

  function createChat(agent: Bot) {
    void runCreation(
      () => onCreateGroup([agent.id], namedConversationGroup(firstName, [agent])),
      'The conversation could not be created',
    )
  }

  function selectGroupAgent(agent: Bot) {
    setSelectedIds((ids) => [...ids, agent.id])
    setQuery('')
    setHighlighted(0)
    setError('')
    inputRef.current?.focus()
  }

  function createGroup() {
    if (selected.length === 0) return
    void runCreation(
      () => onCreateGroup(
        selected.map((agent) => agent.id),
        namedConversationGroup(firstName, selected),
      ),
      'The group chat could not be created',
    )
  }

  function activateHighlighted() {
    if (mode === 'single') {
      if (name && highlighted === 0) return createAgent(name)
      if (!name && highlighted === 0) return createAgent('New Agent')
      if (!name && highlighted === 1) {
        setMode('group')
        setHighlighted(0)
        inputRef.current?.focus()
        return
      }
    }
    const agent = matches[highlighted - fixedActionCount]
    if (agent) mode === 'single' ? createChat(agent) : selectGroupAgent(agent)
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col bg-panel">
      <header className={`flex min-h-12 shrink-0 items-center gap-2 border-b py-1.5 ${mobile ? 'px-2' : 'px-4'}`}>
        {mobile && (
          <button type="button" aria-label="Back" onClick={onBack} className="flex size-9 shrink-0 items-center justify-center rounded-lg hover:bg-muted">
            <ChevronLeft className="size-6" />
          </button>
        )}
        {mode === 'group' && (
          <span className="shrink-0 text-xs font-semibold text-muted-foreground">Group</span>
        )}
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 rounded-lg border bg-background px-2 py-1 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/30">
          {mode === 'group' && selected.map((agent) => (
            <span key={agent.id} className="flex max-w-44 items-center gap-1.5 rounded-full bg-muted py-1 pr-1 pl-1.5 text-xs font-medium">
              <BotAvatar name={agent.name} color={agent.color} shape={agent.shape} src={agent.avatarUrl} className="size-4.5 text-[8px]" />
              <span className="truncate">{agent.name}</span>
              <button type="button" aria-label={`Remove ${agent.name}`} disabled={busy} onClick={() => setSelectedIds((ids) => ids.filter((id) => id !== agent.id))} className="flex size-4 items-center justify-center rounded-full text-muted-foreground hover:bg-background hover:text-foreground">
                <X className="size-3" />
              </button>
            </span>
          ))}
          <input
            ref={inputRef}
            autoFocus
            value={query}
            disabled={busy}
            onChange={(event) => updateQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown' && resultCount > 0) {
                event.preventDefault()
                setHighlighted((index) => (index + 1) % resultCount)
              } else if (event.key === 'ArrowUp' && resultCount > 0) {
                event.preventDefault()
                setHighlighted((index) => (index - 1 + resultCount) % resultCount)
              } else if (event.key === 'Enter') {
                event.preventDefault()
                if (mode === 'group' && !name) createGroup()
                else activateHighlighted()
              }
            }}
            placeholder={mode === 'group' ? 'Add agents' : 'Search agents or create a new one'}
            aria-label={mode === 'group' ? 'Add agents to group chat' : 'Search agents or create a new one'}
            className="h-7 min-w-40 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          {busy && <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <div className="mx-auto flex max-w-xl flex-col gap-1">
          {mode === 'single' && (name ? (
            <ActionRow highlighted={highlighted === 0} disabled={busy} icon={<Plus className="size-4" />} onHover={() => setHighlighted(0)} onClick={() => createAgent(name)}>
              Create “{name}” Agent
            </ActionRow>
          ) : (
            <>
              <ActionRow highlighted={highlighted === 0} disabled={busy} icon={<Plus className="size-4" />} onHover={() => setHighlighted(0)} onClick={() => createAgent('New Agent')}>
                Create new bot
              </ActionRow>
              <ActionRow highlighted={highlighted === 1} disabled={busy} icon={<Users className="size-4" />} onHover={() => setHighlighted(1)} onClick={() => { setMode('group'); setHighlighted(0); inputRef.current?.focus() }}>
                Create group chat
              </ActionRow>
            </>
          ))}
          {matches.map((agent, index) => {
            const resultIndex = index + fixedActionCount
            return (
              <button key={agent.id} type="button" disabled={busy} onMouseEnter={() => setHighlighted(resultIndex)} onClick={() => mode === 'single' ? createChat(agent) : selectGroupAgent(agent)} className={`flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-left ${highlighted === resultIndex ? 'bg-muted' : 'hover:bg-muted'}`}>
                <BotAvatar name={agent.name} color={agent.color} shape={agent.shape} src={agent.avatarUrl} className="size-7 text-[10px]" />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{agent.name}</span>
              </button>
            )
          })}
          {mode === 'group' && !name && selected.length > 0 && (
            <p className="px-3 pt-3 text-center text-xs text-muted-foreground">Press Enter to create the group chat.</p>
          )}
          {matches.length === 0 && mode === 'group' && name && (
            <p className="px-3 py-8 text-center text-xs text-muted-foreground">No agents match “{name}”.</p>
          )}
          {mode === 'group' && agents.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-16 text-center text-muted-foreground">
              <BotIcon className="size-8 opacity-50" />
              <p className="text-sm">Create an agent before starting a group chat.</p>
            </div>
          )}
          {error && <p role="alert" className="px-3 pt-3 text-xs text-destructive">{error}</p>}
        </div>
      </div>
    </div>
  )
}

function ActionRow({ highlighted, disabled, icon, onHover, onClick, children }: {
  highlighted: boolean
  disabled: boolean
  icon: React.ReactNode
  onHover: () => void
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button type="button" disabled={disabled} onMouseEnter={onHover} onClick={onClick} className={`flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-left ${highlighted ? 'bg-muted' : 'hover:bg-muted'}`}>
      <span className="flex size-7 items-center justify-center rounded-lg bg-primary/15 text-primary">{icon}</span>
      <span className="text-sm font-medium">{children}</span>
    </button>
  )
}
