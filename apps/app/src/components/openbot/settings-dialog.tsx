import { useState } from 'react'
import { ArrowUp, Plus, Server, SlidersHorizontal, Sun } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { BotAvatar } from './bot-avatar'
import { PROVIDERS, SERVER_ROWS, type Provider } from './data'

type Tab = 'general' | 'providers' | 'server'

const TABS: { id: Tab; label: string; icon: typeof Sun; group: string }[] = [
  { id: 'general', label: 'General', icon: SlidersHorizontal, group: 'Account' },
  { id: 'providers', label: 'Providers', icon: Sun, group: 'Connection' },
  { id: 'server', label: 'Server', icon: Server, group: 'Connection' },
]

export function SettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [tab, setTab] = useState<Tab>('general')

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[85vh] flex-row gap-0 overflow-hidden p-0 sm:max-w-4xl">
        <DialogTitle className="sr-only">Settings</DialogTitle>
        {/* Nav */}
        <div className="flex w-56 shrink-0 flex-col gap-0.5 border-r bg-sidebar/70 px-3 py-4">
          {['Account', 'Connection'].map((group) => (
            <div key={group} className="contents">
              <div className="px-2.5 pt-3 pb-2 text-xs font-semibold text-muted-foreground first:pt-0">
                {group}
              </div>
              {TABS.filter((t) => t.group === group).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  className={cn(
                    'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm',
                    tab === t.id ? 'bg-muted font-medium' : 'hover:bg-muted/60',
                  )}
                >
                  <t.icon className="size-4 text-muted-foreground" />
                  {t.label}
                </button>
              ))}
            </div>
          ))}
          <div className="flex-1" />
          <div className="px-2.5">
            <div className="text-xs text-muted-foreground">OpenBot</div>
            <div className="mt-0.5 text-xs text-muted-foreground/70">v2.4.1</div>
          </div>
        </div>

        {/* Body */}
        <div className="min-w-0 flex-1 overflow-y-auto px-9 py-7">
          <h2 className="mb-5 text-xl font-bold tracking-tight">
            {TABS.find((t) => t.id === tab)?.label}
          </h2>
          {tab === 'general' && <GeneralTab />}
          {tab === 'providers' && <ProvidersTab />}
          {tab === 'server' && <ServerTab />}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function GeneralTab() {
  return (
    <div className="flex max-w-xl flex-col gap-2.5">
      <h3 className="text-sm font-semibold text-foreground/85">Profile</h3>
      <div className="rounded-xl bg-card px-5 py-4">
        <div className="text-sm font-medium">Name</div>
        <div className="mt-2.5 flex gap-2">
          <Input defaultValue="Mehdi" placeholder="First name" />
          <Input placeholder="Last name" />
        </div>
        <div className="my-4 h-px bg-border" />
        <div className="text-sm font-medium">About</div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Shared with every bot as context — role, timezone, preferences.
        </p>
        <Textarea
          placeholder="What should your bots know about you?"
          className="mt-3 min-h-28 text-xs"
        />
      </div>
    </div>
  )
}

function ProvidersTab() {
  const [providers, setProviders] = useState(PROVIDERS)
  const [keyEntryId, setKeyEntryId] = useState<string | null>(null)

  function setConnected(id: string, connected: boolean) {
    setProviders((all) => all.map((p) => (p.id === id ? { ...p, connected } : p)))
    setKeyEntryId(null)
  }

  const connected = providers.filter((p) => p.connected)
  const popular = providers.filter((p) => !p.connected)

  return (
    <div className="flex max-w-2xl flex-col gap-3.5">
      <h3 className="text-sm font-semibold text-foreground/85">Connected providers</h3>
      {connected.length > 0 ? (
        <div className="rounded-xl bg-card px-5">
          {connected.map((p) => (
            <div key={p.id} className="flex items-center gap-3 border-b py-4 last:border-b-0">
              <BotAvatar name={p.name} color={p.hue} className="size-6.5 text-xs" />
              <span className="text-sm font-semibold">{p.name}</span>
              <Badge variant="outline" className="text-[10px]">
                {p.tag}
              </Badge>
              <span className="flex-1" />
              <button
                type="button"
                onClick={() => setConnected(p.id, false)}
                className="text-xs text-muted-foreground hover:text-destructive"
              >
                Disconnect
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-xl bg-card px-5 py-5 text-xs text-muted-foreground/70">
          No providers connected yet.
        </div>
      )}

      <h3 className="mt-3 text-sm font-semibold text-foreground/85">Popular providers</h3>
      <div className="rounded-xl bg-card px-5">
        {popular.map((p) => (
          <ProviderRow
            key={p.id}
            provider={p}
            keyEntry={keyEntryId === p.id}
            onStart={() => (p.auth === 'key' ? setKeyEntryId(p.id) : setConnected(p.id, true))}
            onSave={() => setConnected(p.id, true)}
            onCancel={() => setKeyEntryId(null)}
          />
        ))}
      </div>
    </div>
  )
}

function ProviderRow({
  provider: p,
  keyEntry,
  onStart,
  onSave,
  onCancel,
}: {
  provider: Provider
  keyEntry: boolean
  onStart: () => void
  onSave: () => void
  onCancel: () => void
}) {
  return (
    <div className="flex items-start gap-3 border-b py-4 last:border-b-0">
      <BotAvatar name={p.name} color={p.hue} className="mt-0.5 size-6.5 text-xs" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">{p.name}</span>
          {p.badge && (
            <Badge variant="outline" className="text-[10px]">
              {p.badge}
            </Badge>
          )}
        </div>
        <p className="mt-1 text-xs leading-normal text-muted-foreground">{p.desc}</p>
        {keyEntry && (
          <div className="mt-2.5 flex gap-2">
            <Input autoFocus placeholder="sk-…" className="font-mono text-xs" />
            <Button size="sm" onClick={onSave}>
              Save
            </Button>
            <Button size="sm" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        )}
      </div>
      {!keyEntry && (
        <Button size="sm" variant="outline" onClick={onStart}>
          <Plus data-icon="inline-start" /> Connect
        </Button>
      )}
    </div>
  )
}

function ServerTab() {
  const [updated, setUpdated] = useState(false)

  return (
    <div className="flex max-w-xl flex-col gap-3">
      <div className="rounded-xl bg-card px-5">
        {SERVER_ROWS.map((r) => (
          <div key={r.key} className="flex items-center gap-4 border-b py-3.5 last:border-b-0">
            <span className="flex-1 text-sm font-medium">{r.key}</span>
            <span
              className={cn(
                'text-sm text-muted-foreground',
                r.mono && 'font-mono text-xs',
                r.key === 'Status' && 'text-success',
              )}
            >
              {r.key === 'Version' && updated ? 'v2.5.0' : r.val}
            </span>
            {r.hasUpdate && !updated && (
              <Button size="xs" onClick={() => setUpdated(true)}>
                <ArrowUp data-icon="inline-start" /> Update to v2.5.0
              </Button>
            )}
          </div>
        ))}
      </div>
      <p className="px-1 text-xs leading-normal text-muted-foreground/70">
        Bots run on this server. Contact your admin to change it.
      </p>
    </div>
  )
}
