import { useState } from 'react'
import type { Group } from '@openbot/db'
import { ChevronLeft, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { BotAvatar } from './bot-avatar'
import type { Bot } from '@openbot/client/openbot/data'
import { orpc } from '@/lib/orpc'

function memberInput(memberIds: string[]) {
  return memberIds.map((agentId) => ({ type: 'agent' as const, agentId }))
}

function GroupMembersEditor({
  group,
  members,
  agents,
  onOpenMember,
  onChanged,
}: {
  group: Group
  members: Bot[]
  agents: Bot[]
  onOpenMember: (agentId: string) => void
  onChanged: () => void | Promise<void>
}) {
  const [query, setQuery] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const memberIds = members.map((member) => member.id)
  const available = agents.filter((agent) => !memberIds.includes(agent.id))

  async function save(nextMemberIds: string[]) {
    if (saving) return
    setSaving(true)
    setError('')
    try {
      await orpc.groups.setMembers({ id: group.id, members: memberInput(nextMemberIds) })
      setQuery('')
      await onChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Group members could not be updated')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        {members.map((member) => (
          <div key={member.id} className="group/member flex items-center gap-2.5 border-b px-3 py-2.5 last:border-b-0">
            <BotAvatar
              name={member.name}
              color={member.color}
              shape={member.shape}
              src={member.avatarUrl}
              className="size-7 text-[10px]"
            />
            <button
              type="button"
              onClick={() => onOpenMember(member.id)}
              className="min-w-0 flex-1 truncate text-left text-sm font-medium hover:text-info"
            >
              {member.name}
            </button>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={`Remove ${member.name}`}
              title={members.length === 1 ? 'A group requires at least one agent' : `Remove ${member.name}`}
              disabled={saving || members.length === 1}
              onClick={() => void save(memberIds.filter((id) => id !== member.id))}
              className="text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        ))}

        <div className="border-t p-2.5">
          <Command className="rounded-lg border bg-card">
            <CommandInput
              value={query}
              onValueChange={setQuery}
              placeholder="Add a member…"
              disabled={saving || available.length === 0}
            />
            {query.trim() && (
              <CommandList className="max-h-48 p-1">
                <CommandEmpty>No agents match</CommandEmpty>
                {available.map((agent) => (
                  <CommandItem
                    key={agent.id}
                    value={agent.name}
                    onSelect={() => void save([...memberIds, agent.id])}
                  >
                    <BotAvatar
                      name={agent.name}
                      color={agent.color}
                      shape={agent.shape}
                      src={agent.avatarUrl}
                      className="size-5.5 text-[9px]"
                    />
                    <span className="truncate">{agent.name}</span>
                  </CommandItem>
                ))}
              </CommandList>
            )}
          </Command>
          {available.length === 0 && (
            <p className="mt-2 text-[11px] text-muted-foreground">All agents are already members.</p>
          )}
          {error && <p role="alert" className="mt-2 text-[11px] text-destructive">{error}</p>}
        </div>
      </div>
    </div>
  )
}

export function GroupInspector(props: {
  group: Group
  members: Bot[]
  agents: Bot[]
  onOpenMember: (agentId: string) => void
  onChanged: () => void | Promise<void>
}) {
  return (
    <aside className="flex w-78 shrink-0 flex-col border-l bg-sidebar/70">
      <div className="border-b px-3.5 py-4">
        <h2 className="text-sm font-semibold">Members</h2>
        <p className="mt-0.5 text-[11px] text-muted-foreground">Manage who participates in this chat.</p>
      </div>
      <GroupMembersEditor {...props} />
    </aside>
  )
}

export function MobileGroupMembers({
  onBack,
  ...props
}: {
  group: Group
  members: Bot[]
  agents: Bot[]
  onOpenMember: (agentId: string) => void
  onChanged: () => void | Promise<void>
  onBack: () => void
}) {
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col bg-panel">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b px-2">
        <Button variant="ghost" size="icon" aria-label="Back to conversation" onClick={onBack}>
          <ChevronLeft className="size-6" />
        </Button>
        <h2 className="truncate text-sm font-semibold">Members</h2>
      </header>
      <GroupMembersEditor {...props} />
    </div>
  )
}
