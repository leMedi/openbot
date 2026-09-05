import { useEffect, useRef, useState } from 'react'
import type {
  ProviderAuthFlowEvent,
  ProviderAuthMethodDto,
  ProviderConfigurationDto,
  ProviderDto,
} from '@openbot/agent'
import { PROVIDER_DESCRIPTIONS, sortProviders } from '@openbot/plugins/provider-icons'
import type { Profile, Setting } from '@openbot/db'
import {
  ArrowUp,
  Check,
  ChevronRight,
  Copy,
  Database,
  ExternalLink,
  MessageCircle,
  Loader2,
  Bot,
  Brain,
  Plus,
  RefreshCw,
  Server,
  SlidersHorizontal,
  Sun,
  Trash2,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { clearAppData, type AppDataTarget } from '@/server/data'
import { saveUserProfile } from '@/server/profile'
import {
  disconnectAiProvider,
  getAiProviders,
  refreshAiProviders,
  saveAiModelSettings,
} from '@/server/providers'
import { ModelPicker } from './model-picker'
import { ProviderBrandIcon } from './provider-brand-icon'
import {
  checkServerUpdate,
  getServerConfig,
  getServerUpdate,
  startServerUpdate,
} from '@/server/config'

type Tab = 'general' | 'providers' | 'server' | 'data'

const TABS: { id: Tab; label: string; icon: typeof Sun; group: string }[] = [
  { id: 'general', label: 'General', icon: SlidersHorizontal, group: 'Account' },
  { id: 'providers', label: 'Providers', icon: Sun, group: 'Connection' },
  { id: 'server', label: 'Server', icon: Server, group: 'Connection' },
  { id: 'data', label: 'Data', icon: Database, group: 'System' },
]

export function SettingsDialog({
  open,
  onOpenChange,
  profile,
  onProfileSaved,
  providerConfiguration,
  onProvidersChanged,
  onServerUpdateStatus,
  onDataCleared,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  profile: Profile
  onProfileSaved: (profile: Profile) => void
  providerConfiguration: ProviderConfigurationDto & { setting: Setting }
  onProvidersChanged: () => void
  onServerUpdateStatus: (updateAvailable: boolean) => void
  onDataCleared: (firstConversationId: string | null) => void | Promise<void>
}) {
  const [tab, setTab] = useState<Tab>('general')
  const [displayProfile, setDisplayProfile] = useState(profile)

  useEffect(() => {
    if (!open) {
      setDisplayProfile((current) =>
        profile.updatedAt > current.updatedAt ? profile : current,
      )
    }
  }, [open, profile])

  function profileSaved(updated: Profile) {
    setDisplayProfile(updated)
    onProfileSaved(updated)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:flex-row sm:max-w-4xl">
        <DialogTitle className="sr-only">Settings</DialogTitle>
        {/* Nav */}
        <div className="flex shrink-0 gap-0.5 overflow-x-auto border-b bg-sidebar/70 px-3 py-2 pr-12 sm:w-56 sm:flex-col sm:border-r sm:border-b-0 sm:py-4 sm:pr-3">
          {['Account', 'Connection', 'System'].map((group) => (
            <div key={group} className="contents">
              <div className="hidden px-2.5 pt-3 pb-2 text-xs font-semibold text-muted-foreground first:pt-0 sm:block">
                {group}
              </div>
              {TABS.filter((t) => t.group === group).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  className={cn(
                    'flex shrink-0 items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm',
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
          <div className="hidden px-2.5 sm:block">
            <div className="text-xs text-muted-foreground">OpenBot</div>
            <div className="mt-0.5 text-xs text-muted-foreground/70">v2.4.1</div>
          </div>
        </div>

        {/* Body */}
        <div className="min-w-0 flex-1 overflow-y-auto px-5 py-5 sm:px-9 sm:py-7">
          <h2 className="mb-5 text-xl font-bold tracking-tight">
            {TABS.find((t) => t.id === tab)?.label}
          </h2>
          <div className={tab === 'general' ? undefined : 'hidden'}>
            <GeneralTab open={open} profile={displayProfile} onSaved={profileSaved} />
          </div>
          {tab === 'providers' && (
            <ProvidersTab
              initialConfiguration={providerConfiguration}
              onChanged={onProvidersChanged}
            />
          )}
          {tab === 'server' && <ServerTab open={open} onUpdateStatus={onServerUpdateStatus} />}
          {tab === 'data' && (
            <DataTab open={open} onDataCleared={onDataCleared} />
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

const DATA_OPTIONS: {
  id: AppDataTarget
  label: string
  description: string
  icon: typeof Database
}[] = [
  {
    id: 'conversations',
    label: 'Conversations',
    description: 'Delete every conversation and message. Group rooms will be recreated empty.',
    icon: MessageCircle,
  },
  {
    id: 'bots',
    label: 'Agents',
    description: 'Delete all agents, their conversations, private memory, and access grants.',
    icon: Bot,
  },
  {
    id: 'memory',
    label: 'Memory',
    description: 'Delete all shared and agent-specific memory.',
    icon: Brain,
  },
]

function DataTab({
  open,
  onDataCleared,
}: {
  open: boolean
  onDataCleared: (firstConversationId: string | null) => void | Promise<void>
}) {
  const [selected, setSelected] = useState<AppDataTarget[]>([])
  const [confirming, setConfirming] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cleared, setCleared] = useState(false)

  useEffect(() => {
    if (open) return
    setSelected([])
    setConfirming(false)
    setError(null)
    setCleared(false)
  }, [open])

  function toggle(target: AppDataTarget) {
    setCleared(false)
    setSelected((current) =>
      current.includes(target)
        ? current.filter((item) => item !== target)
        : [...current, target],
    )
  }

  async function clear() {
    if (selected.length === 0 || clearing) return
    setClearing(true)
    setError(null)
    try {
      const { firstConversationId } = await clearAppData({
        data: { targets: selected },
      })
      await onDataCleared(firstConversationId)
      setConfirming(false)
      setSelected([])
      setCleared(true)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Selected data could not be cleared')
    } finally {
      setClearing(false)
    }
  }

  const selectedLabels = DATA_OPTIONS
    .filter((option) => selected.includes(option.id))
    .map((option) => option.label)

  return (
    <div className="flex max-w-xl flex-col gap-2.5">
      <div>
        <h3 className="text-sm font-semibold text-foreground/85">Clear app data</h3>
        <p className="mt-1 text-xs leading-normal text-muted-foreground">
          Select one or more types of data to permanently delete.
        </p>
      </div>
      <div className="rounded-xl bg-card px-5">
        {DATA_OPTIONS.map((option) => (
          <label
            key={option.id}
            className="flex cursor-pointer items-center gap-3 border-b py-4 last:border-b-0"
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              <option.icon className="size-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">{option.label}</span>
              <span className="mt-0.5 block text-xs leading-normal text-muted-foreground">
                {option.description}
              </span>
            </span>
            <Checkbox
              checked={selected.includes(option.id)}
              onCheckedChange={() => toggle(option.id)}
              aria-label={`Clear ${option.label}`}
            />
          </label>
        ))}
      </div>
      <div className="flex items-center gap-3 pt-1">
        <span aria-live="polite" className="min-w-0 flex-1 text-xs text-muted-foreground">
          {cleared ? 'Selected data was deleted.' : null}
        </span>
        <Button
          size="sm"
          variant="destructive"
          disabled={selected.length === 0}
          onClick={() => {
            setError(null)
            setConfirming(true)
          }}
        >
          <Trash2 data-icon="inline-start" /> Clear selected
        </Button>
      </div>

      <Dialog
        open={confirming}
        onOpenChange={(nextOpen) => {
          if (!clearing) setConfirming(nextOpen)
        }}
      >
        <DialogContent showCloseButton={false} className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Clear selected data?</DialogTitle>
          </DialogHeader>
          <p className="text-xs leading-normal text-muted-foreground">
            This will permanently delete {selectedLabels.join(', ')}. This action cannot be
            undone.
          </p>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <DialogFooter>
            <Button
              variant="secondary"
              size="sm"
              disabled={clearing}
              onClick={() => setConfirming(false)}
            >
              Cancel
            </Button>
            <Button variant="destructive" size="sm" disabled={clearing} onClick={clear}>
              {clearing ? 'Clearing…' : 'Clear data'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function GeneralTab({
  open,
  profile,
  onSaved,
}: {
  open: boolean
  profile: Profile
  onSaved: (profile: Profile) => void
}) {
  const [firstName, setFirstName] = useState(profile.firstName)
  const [lastName, setLastName] = useState(profile.lastName)
  const [about, setAbout] = useState(profile.about)
  const [timezone, setTimezone] = useState(profile.timezone)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [timezones, setTimezones] = useState(() =>
    Array.from(new Set([profile.timezone, 'UTC'].filter(Boolean))),
  )

  useEffect(() => {
    const supported =
      typeof Intl.supportedValuesOf === 'function'
        ? Intl.supportedValuesOf('timeZone')
        : []
    const detected = Intl.DateTimeFormat().resolvedOptions().timeZone
    setTimezones(
      Array.from(
        new Set([profile.timezone, detected, 'UTC', ...supported].filter(Boolean)),
      ),
    )
    if (!profile.timezone) setTimezone(detected || 'UTC')
  }, [])

  useEffect(() => {
    if (!open) {
      setFirstName(profile.firstName)
      setLastName(profile.lastName)
      setAbout(profile.about)
      setTimezone(profile.timezone)
      setSaved(false)
      setError(null)
    } else if (!profile.timezone) {
      setTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC')
    }
  }, [open, profile])

  async function save() {
    if (saving) return
    setSaving(true)
    setSaved(false)
    setError(null)
    try {
      const updated = await saveUserProfile({
        data: { firstName, lastName, about, timezone },
      })
      onSaved(updated)
      setSaved(true)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Saving the profile failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex max-w-xl flex-col gap-2.5">
      <h3 className="text-sm font-semibold text-foreground/85">Profile</h3>
      <div className="rounded-xl bg-card px-5 py-4">
        <div className="text-sm font-medium">Name</div>
        <div className="mt-2.5 flex gap-2">
          <Input
            value={firstName}
            onChange={(event) => setFirstName(event.target.value)}
            placeholder="First name"
            maxLength={80}
          />
          <Input
            value={lastName}
            onChange={(event) => setLastName(event.target.value)}
            placeholder="Last name"
            maxLength={80}
          />
        </div>
        <div className="my-4 h-px bg-border" />
        <label htmlFor="profile-timezone" className="text-sm font-medium">
          Timezone
        </label>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Helps your agents understand dates and local times.
        </p>
        <select
          id="profile-timezone"
          value={timezone}
          onChange={(event) => setTimezone(event.target.value)}
          className="mt-3 h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"
        >
          {timezones.map((value) => (
            <option key={value} value={value}>
              {value.replaceAll('_', ' ')}
            </option>
          ))}
        </select>
        <div className="my-4 h-px bg-border" />
        <div className="text-sm font-medium">About</div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Shared with every agent as context, including your role and preferences.
        </p>
        <Textarea
          value={about}
          onChange={(event) => setAbout(event.target.value)}
          placeholder="What should your agents know about you?"
          className="mt-3 min-h-28 text-xs"
          maxLength={1000}
        />
        <div className="mt-4 flex items-center justify-end gap-3">
          <span aria-live="polite" className="mr-auto text-xs text-muted-foreground">
            {error ? (
              <span className="text-destructive">{error}</span>
            ) : saved ? (
              'Saved'
            ) : null}
          </span>
          <Button size="sm" onClick={save} disabled={saving || !timezone}>
            {saving ? 'Saving…' : 'Save Profile'}
          </Button>
        </div>
      </div>
    </div>
  )
}

type ProviderView = ProviderConfigurationDto & { setting: Setting }

type AuthType = ProviderAuthMethodDto['type']

type ActiveAuthFlow = {
  flowId: string
  authType: AuthType
  prompt?: Extract<ProviderAuthFlowEvent, { type: 'prompt' }>
  notifications: Extract<ProviderAuthFlowEvent, { type: 'notification' }>[]
  error?: string
}

type ConnectSession = {
  provider: ProviderDto
  /** Whether the method picker was shown, so the flow can offer "Back". */
  chose: boolean
  flow: ActiveAuthFlow | null
}

const METHOD_DESCRIPTIONS: Record<AuthType, string> = {
  api_key: 'Paste a key from your provider dashboard',
  oauth: 'Sign in with your browser to use your existing plan',
}

function ProvidersTab({
  initialConfiguration,
  onChanged,
}: {
  initialConfiguration: ProviderView
  onChanged: () => void
}) {
  const [configuration, setConfiguration] = useState(initialConfiguration)
  const [query, setQuery] = useState('')
  const [session, setSession] = useState<ConnectSession | null>(null)
  const [answer, setAnswer] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const eventSourceRef = useRef<EventSource | null>(null)
  const flowIdRef = useRef<string | null>(null)

  useEffect(() => setConfiguration(initialConfiguration), [initialConfiguration])
  useEffect(() => () => {
    eventSourceRef.current?.close()
    const flowId = flowIdRef.current
    if (flowId) void fetch(`/api/provider-auth-flows/${flowId}`, { method: 'DELETE' })
  }, [])

  const connected = sortProviders(configuration.providers.filter((provider) => provider.connected))
  const normalizedQuery = query.trim().toLowerCase()
  const available = sortProviders(configuration.providers.filter((provider) =>
    !provider.connected
    && (!normalizedQuery || provider.name.toLowerCase().includes(normalizedQuery)),
  ))
  const modelOptions = configuration.models

  async function reload() {
    const updated = await getAiProviders()
    setConfiguration(updated)
    onChanged()
  }

  function closeEventSource() {
    eventSourceRef.current?.close()
    eventSourceRef.current = null
    flowIdRef.current = null
  }

  function openConnect(provider: ProviderDto) {
    if (provider.authMethods.length === 0) return
    setError(null)
    setAnswer('')
    if (provider.authMethods.length === 1) {
      setSession({ provider, chose: false, flow: null })
      void startLogin(provider, provider.authMethods[0].type)
    } else {
      setSession({ provider, chose: true, flow: null })
    }
  }

  async function startLogin(provider: ProviderDto, authType: AuthType) {
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(`/api/providers/${encodeURIComponent(provider.id)}/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ authType }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error ?? 'Provider login could not start')

      const flow: ActiveAuthFlow = { flowId: body.flowId, authType, notifications: [] }
      setSession((current) => current ? { ...current, flow } : { provider, chose: false, flow })
      flowIdRef.current = body.flowId
      const source = new EventSource(`/api/provider-auth-flows/${body.flowId}/stream`)
      eventSourceRef.current = source
      const patchFlow = (patch: (flow: ActiveAuthFlow) => ActiveAuthFlow) =>
        setSession((current) => current?.flow ? { ...current, flow: patch(current.flow) } : current)
      source.onmessage = (message) => {
        const event = JSON.parse(message.data) as ProviderAuthFlowEvent
        if (event.type === 'prompt') {
          setAnswer('')
          patchFlow((flow) => ({ ...flow, prompt: event }))
        } else if (event.type === 'prompt_answered') {
          patchFlow((flow) => flow.prompt?.promptId === event.promptId
            ? { ...flow, prompt: undefined }
            : flow)
        } else if (event.type === 'notification') {
          patchFlow((flow) => ({ ...flow, notifications: [...flow.notifications, event] }))
        } else if (event.type === 'complete') {
          closeEventSource()
          setSession(null)
          void reload().catch((cause) => setError(
            cause instanceof Error ? cause.message : 'Provider list could not be reloaded',
          ))
        } else if (event.type === 'error') {
          closeEventSource()
          patchFlow((flow) => ({ ...flow, error: event.message }))
        }
      }
      source.onerror = () => {
        if (eventSourceRef.current !== source) return
        closeEventSource()
        patchFlow((flow) => ({ ...flow, error: 'The provider login connection closed unexpectedly' }))
      }
    } catch (cause) {
      setSession((current) => current
        ? { ...current, flow: { flowId: '', authType, notifications: [], error: cause instanceof Error ? cause.message : 'Provider login could not start' } }
        : current)
    } finally {
      setBusy(false)
    }
  }

  async function submitPrompt() {
    const flow = session?.flow
    if (!flow?.prompt) return
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(`/api/provider-auth-flows/${flow.flowId}/respond`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ promptId: flow.prompt.promptId, value: answer }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error ?? 'Login response was rejected')
    } catch (cause) {
      setSession((current) => current?.flow
        ? { ...current, flow: { ...current.flow, error: cause instanceof Error ? cause.message : 'Login response was rejected' } }
        : current)
    } finally {
      setBusy(false)
    }
  }

  async function abandonFlow() {
    const flowId = flowIdRef.current
    closeEventSource()
    if (flowId) await fetch(`/api/provider-auth-flows/${flowId}`, { method: 'DELETE' })
  }

  async function cancelConnect() {
    await abandonFlow()
    setSession(null)
    setAnswer('')
  }

  async function backToMethods() {
    await abandonFlow()
    setAnswer('')
    setSession((current) => current ? { ...current, flow: null } : current)
  }

  async function disconnect(providerId: string) {
    setBusy(true)
    setError(null)
    try {
      const catalog = await disconnectAiProvider({ data: { providerId } })
      setConfiguration((current) => ({ ...catalog, setting: current.setting }))
      onChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Provider could not be disconnected')
    } finally {
      setBusy(false)
    }
  }

  async function saveDefaults() {
    setBusy(true)
    setError(null)
    try {
      const setting = await saveAiModelSettings({
        data: {
          defaultAgentModel: configuration.setting.defaultAgentModel,
          orchestratorModel: configuration.setting.orchestratorModel,
        },
      })
      setConfiguration((current) => ({ ...current, setting }))
      onChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Model defaults could not be saved')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex max-w-2xl flex-col gap-3.5">
      <div className="flex items-center">
        <h3 className="flex-1 text-sm font-semibold text-foreground/85">Model defaults</h3>
        <Button
          size="xs"
          variant="ghost"
          disabled={busy}
          onClick={() => {
            setBusy(true)
            setError(null)
            void refreshAiProviders({ data: {} })
              .then((catalog) => setConfiguration((current) => ({
                ...catalog,
                setting: current.setting,
              })))
              .then(onChanged)
              .catch((cause) => setError(
                cause instanceof Error ? cause.message : 'Model catalogs could not be refreshed',
              ))
              .finally(() => setBusy(false))
          }}
        >
          <RefreshCw data-icon="inline-start" /> Refresh catalogs
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-3 rounded-xl bg-card px-5 py-4">
        <ModelDefaultField
          label="Default agent"
          value={configuration.setting.defaultAgentModel}
          models={modelOptions}
          onChange={(value) => setConfiguration((current) => ({
            ...current,
            setting: { ...current.setting, defaultAgentModel: value },
          }))}
        />
        <ModelDefaultField
          label="Group orchestrator"
          value={configuration.setting.orchestratorModel}
          models={modelOptions}
          onChange={(value) => setConfiguration((current) => ({
            ...current,
            setting: { ...current.setting, orchestratorModel: value },
          }))}
        />
        <div className="col-span-2 flex justify-end">
          <Button size="sm" disabled={busy || modelOptions.length === 0} onClick={saveDefaults}>
            Save defaults
          </Button>
        </div>
      </div>

      <h3 className="mt-3 text-sm font-semibold text-foreground/85">Connected providers</h3>
      {connected.length > 0 ? (
        <div className="rounded-xl bg-card px-5">
          {connected.map((provider) => (
            <div key={provider.id} className="flex items-center gap-3 border-b py-4 last:border-b-0">
              <ProviderBrandIcon provider={provider} />
              <span className="text-sm font-semibold">{provider.name}</span>
              <Badge variant="outline" className="text-[10px]">
                {connectionLabel(provider)}
              </Badge>
              <span className="text-[10px] text-muted-foreground">
                {provider.modelCount} models
              </span>
              <span className="flex-1" />
              {provider.authMethods.length > 0 && (
                <button
                  type="button"
                  disabled={busy || !!session}
                  onClick={() => openConnect(provider)}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  {provider.connectionSource === 'stored' ? 'Reconnect' : 'Override'}
                </button>
              )}
              {provider.connectionSource === 'stored' ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void disconnect(provider.id)}
                  className="text-xs text-muted-foreground hover:text-destructive"
                >
                  Disconnect
                </button>
              ) : provider.authMethods.length === 0 ? (
                <span className="text-[10px] text-muted-foreground">Managed externally</span>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-xl bg-card px-5 py-5 text-xs text-muted-foreground/70">
          No providers connected yet.
        </div>
      )}

      <div className="mt-3 flex items-center gap-3">
        <h3 className="flex-1 text-sm font-semibold text-foreground/85">Available providers</h3>
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search providers…"
          aria-label="Search providers"
          className="h-7 w-48 text-xs"
        />
      </div>
      <div className="rounded-xl bg-card px-5">
        {available.map((provider) => (
          <ProviderRow
            key={provider.id}
            provider={provider}
            busy={busy || !!session}
            onConnect={() => openConnect(provider)}
          />
        ))}
        {available.length === 0 && (
          <div className="py-4 text-xs text-muted-foreground/70">
            {normalizedQuery
              ? `No providers match “${query.trim()}”.`
              : 'Every provider is connected.'}
          </div>
        )}
      </div>

      {(error || configuration.error) && (
        <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {error ?? configuration.error}
        </p>
      )}

      <ConnectProviderDialog
        session={session}
        answer={answer}
        busy={busy}
        onAnswer={setAnswer}
        onPickMethod={(authType) => session && void startLogin(session.provider, authType)}
        onSubmit={() => void submitPrompt()}
        onBack={() => void backToMethods()}
        onCancel={() => void cancelConnect()}
      />
    </div>
  )
}

function connectionLabel(provider: ProviderDto) {
  switch (provider.connectionSource) {
    case 'stored': return 'Connected'
    case 'env': return 'Environment'
    case undefined: return 'Connected'
    default: return provider.connectionSource
  }
}

function ProviderRow({
  provider,
  busy,
  onConnect,
}: {
  provider: ProviderDto
  busy: boolean
  onConnect: () => void
}) {
  const description = PROVIDER_DESCRIPTIONS[provider.id]
    ?? (provider.authMethods.length > 0
      ? provider.authMethods.map((method) => method.label).join(' or ')
      : 'Requires credentials configured on the server.')
  return (
    <div className="flex items-center gap-3 border-b py-4 last:border-b-0">
      <ProviderBrandIcon provider={provider} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">{provider.name}</span>
          {provider.id === 'openrouter' && (
            <Badge variant="outline" className="text-[10px]">Recommended</Badge>
          )}
          {provider.modelCount > 0 && (
            <span className="text-[10px] text-muted-foreground">{provider.modelCount} models</span>
          )}
        </div>
        <p className="mt-0.5 text-xs leading-normal text-muted-foreground">{description}</p>
      </div>
      {provider.authMethods.length > 0 && (
        <Button size="sm" variant="outline" disabled={busy} onClick={onConnect}>
          <Plus data-icon="inline-start" /> Connect
        </Button>
      )}
    </div>
  )
}

function ModelDefaultField({
  label,
  value,
  models,
  onChange,
}: {
  label: string
  value: string
  models: ProviderConfigurationDto['models']
  onChange: (value: string) => void
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5 text-xs font-medium">
      {label}
      <ModelPicker value={value} models={models} onChange={onChange} className="text-xs" />
    </div>
  )
}

function ConnectProviderDialog({
  session,
  answer,
  busy,
  onAnswer,
  onPickMethod,
  onSubmit,
  onBack,
  onCancel,
}: {
  session: ConnectSession | null
  answer: string
  busy: boolean
  onAnswer: (answer: string) => void
  onPickMethod: (authType: AuthType) => void
  onSubmit: () => void
  onBack: () => void
  onCancel: () => void
}) {
  const provider = session?.provider
  const flow = session?.flow ?? null
  const prompt = flow?.prompt?.prompt
  const authUrl = flow?.notifications.find((item) => item.notification.type === 'auth_url')
  const deviceCode = flow?.notifications.find((item) => item.notification.type === 'device_code')
  const infos = flow?.notifications.filter((item) =>
    item.notification.type !== 'auth_url' && item.notification.type !== 'device_code',
  ) ?? []
  const waiting = !!flow && !flow.error && !prompt && (flow.flowId !== '')
  const showBack = !!session?.chose && !!flow

  return (
    <Dialog open={!!session} onOpenChange={(open) => { if (!open) onCancel() }}>
      <DialogContent showCloseButton={false} className="gap-0 p-5 sm:max-w-sm">
        {provider && (
          <>
            <div className="flex items-center gap-2.5">
              <ProviderBrandIcon provider={provider} className="size-7" />
              <DialogTitle className="text-sm font-semibold">Connect {provider.name}</DialogTitle>
            </div>

            {!flow && (
              <div className="mt-3 flex flex-col gap-2">
                <p className="text-xs text-muted-foreground">How do you want to connect?</p>
                {provider.authMethods.map((method) => (
                  <button
                    key={method.type}
                    type="button"
                    disabled={busy}
                    onClick={() => onPickMethod(method.type)}
                    className="flex items-center gap-3 rounded-lg border px-3 py-2.5 text-left hover:border-ring/60 hover:bg-accent/40"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-semibold">{method.label}</span>
                      <span className="mt-0.5 block text-xs leading-normal text-muted-foreground">
                        {METHOD_DESCRIPTIONS[method.type]}
                      </span>
                    </span>
                    <ChevronRight className="size-4 text-muted-foreground" />
                  </button>
                ))}
              </div>
            )}

            {flow && (
              <div className="mt-3 flex flex-col gap-3 text-xs text-muted-foreground">
                {infos.map(({ notification }, index) => (
                  <div key={index} className="flex flex-col gap-1">
                    {'message' in notification && <span>{notification.message}</span>}
                    {notification.type === 'info' && notification.links?.map((link) => (
                      <a
                        key={link.url}
                        href={link.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-info hover:underline"
                      >
                        {link.label ?? link.url} <ExternalLink className="size-3" />
                      </a>
                    ))}
                  </div>
                ))}

                {authUrl?.notification.type === 'auth_url' && !prompt && (
                  <div className="flex flex-col gap-3">
                    <p className="leading-relaxed">
                      {authUrl.notification.instructions
                        ?? `Authorize OpenBot with your ${provider.name} account in the browser, then come back here.`}
                    </p>
                    <div className="truncate rounded-md border bg-background px-2.5 py-1.5 font-mono text-[11px]">
                      {authUrl.notification.url}
                    </div>
                    <Button
                      size="sm"
                      render={<a href={authUrl.notification.url} target="_blank" rel="noreferrer" />}
                    >
                      Continue in browser <ExternalLink data-icon="inline-end" />
                    </Button>
                  </div>
                )}

                {deviceCode?.notification.type === 'device_code' && !prompt && (
                  <DeviceCodePanel
                    code={deviceCode.notification.userCode}
                    verificationUri={deviceCode.notification.verificationUri}
                  />
                )}

                {prompt && (
                  <div className="flex flex-col gap-2">
                    <label className="font-medium text-foreground">{prompt.message}</label>
                    {prompt.type === 'select' ? (
                      <select
                        autoFocus
                        value={answer}
                        onChange={(event) => onAnswer(event.target.value)}
                        className="h-8 rounded-lg border border-input bg-transparent px-2 text-xs text-foreground dark:bg-input/30"
                      >
                        <option value="">Choose…</option>
                        {prompt.options.map((option) => (
                          <option key={option.id} value={option.id}>{option.label}</option>
                        ))}
                      </select>
                    ) : (
                      <Input
                        autoFocus
                        type={prompt.type === 'secret' ? 'password' : 'text'}
                        value={answer}
                        placeholder={prompt.placeholder}
                        onChange={(event) => onAnswer(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' && answer) onSubmit()
                        }}
                        className="font-mono text-xs"
                      />
                    )}
                    {prompt.type === 'select' && answer && (
                      <p>{prompt.options.find((option) => option.id === answer)?.description}</p>
                    )}
                    <Button size="sm" disabled={busy || !answer} onClick={onSubmit}>
                      {prompt.type === 'secret' ? 'Connect' : 'Continue'}
                    </Button>
                  </div>
                )}

                {waiting && (
                  <div className="flex items-center justify-center gap-2 py-2">
                    <Loader2 className="size-3.5 animate-spin text-info" />
                    <span>
                      {authUrl || deviceCode
                        ? 'Waiting — finish authorizing in your browser…'
                        : 'Waiting for the provider…'}
                    </span>
                  </div>
                )}

                {flow.error && (
                  <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-destructive">
                    {flow.error}
                  </p>
                )}
              </div>
            )}

            <div className="mt-4 flex items-center justify-between">
              {showBack ? (
                <button
                  type="button"
                  onClick={onBack}
                  className="text-xs font-medium text-muted-foreground hover:text-foreground"
                >
                  ← Back
                </button>
              ) : <span />}
              <Button size="sm" variant="secondary" onClick={onCancel}>Cancel</Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

function DeviceCodePanel({
  code,
  verificationUri,
}: {
  code: string
  verificationUri: string
}) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard access can be denied; the code stays visible for manual copy.
    }
  }
  return (
    <div className="flex flex-col items-center gap-2 py-2 text-center">
      <div className="font-mono text-2xl font-bold tracking-[.18em] text-foreground">{code}</div>
      {copied && (
        <span className="flex items-center gap-1 text-[11px] text-success">
          <Check className="size-3" /> Copied to clipboard
        </span>
      )}
      <p>
        Go to{' '}
        <a href={verificationUri} target="_blank" rel="noreferrer" className="font-mono text-info hover:underline">
          {verificationUri.replace(/^https?:\/\//, '')}
        </a>{' '}
        and paste the code.
      </p>
      <div className="mt-1 flex gap-2">
        <Button size="sm" variant="secondary" onClick={() => void copy()}>
          <Copy data-icon="inline-start" /> Copy code
        </Button>
        <Button size="sm" render={<a href={verificationUri} target="_blank" rel="noreferrer" />}>
          Open link <ExternalLink data-icon="inline-end" />
        </Button>
      </div>
    </div>
  )
}

function ServerTab({
  open,
  onUpdateStatus,
}: {
  open: boolean
  onUpdateStatus: (updateAvailable: boolean) => void
}) {
  const [status, setStatus] = useState<Awaited<ReturnType<typeof getServerUpdate>> | null>(null)
  const [host, setHost] = useState('—')
  const [latency, setLatency] = useState<number | null>(null)
  const [checking, setChecking] = useState(false)
  const [updating, setUpdating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const updateAbortRef = useRef<AbortController | null>(null)

  useEffect(() => () => updateAbortRef.current?.abort(), [])

  async function check() {
    if (checking) return
    setChecking(true); setError(null)
    const started = performance.now()
    try {
      const [nextStatus, config] = await Promise.all([checkServerUpdate(), getServerConfig()])
      setStatus(nextStatus); onUpdateStatus(nextStatus.updateAvailable); setHost(config.host); setLatency(Math.round(performance.now() - started))
    } catch (cause) {
      onUpdateStatus(false)
      setError(cause instanceof Error ? cause.message : 'Could not check the server')
    }
    finally { setChecking(false) }
  }

  useEffect(() => {
    if (!open) return
    void Promise.all([getServerUpdate(), getServerConfig()]).then(([nextStatus, config]) => {
      setStatus(nextStatus); onUpdateStatus(nextStatus.updateAvailable); setHost(config.host)
      const started = performance.now()
      return getServerConfig().then(() => setLatency(Math.round(performance.now() - started)))
    }).catch((cause) => {
      onUpdateStatus(false)
      setError(cause instanceof Error ? cause.message : 'Could not load server status')
    })
  }, [open])

  async function update() {
    if (!status?.updateAvailable || updating) return
    setUpdating(true); setError(null)
    const previousSha = status.installedVersion.slice(0, 12).toLowerCase()
    const controller = new AbortController()
    updateAbortRef.current?.abort()
    updateAbortRef.current = controller
    try {
      const deadline = Date.now() + 180_000
      let startTimeout: number | undefined
      try {
        await Promise.race([
          startServerUpdate(),
          new Promise<void>((resolve) => {
            startTimeout = window.setTimeout(resolve, 15_000)
          }),
        ])
      } finally {
        window.clearTimeout(startTimeout)
      }
      while (Date.now() < deadline) {
        await new Promise((resolve) => window.setTimeout(resolve, 2_000))
        if (controller.signal.aborted) return
        if (Date.now() >= deadline) break
        try {
          const response = await fetch('/api/server-version', {
            cache: 'no-store',
            signal: AbortSignal.any([
              controller.signal,
              AbortSignal.timeout(Math.max(1, Math.min(5_000, deadline - Date.now()))),
            ]),
          })
          if (!response.ok) continue
          const { installedVersion } = await response.json() as { installedVersion: string }
          if (installedVersion.slice(0, 12).toLowerCase() !== previousSha) {
            window.location.reload()
            return
          }
        } catch {
          // The server is expected to be unavailable briefly while it restarts.
        }
      }
      setError('The server did not come back with the update within 3 minutes')
      setUpdating(false)
    } catch (cause) {
      if (controller.signal.aborted) return
      setError(cause instanceof Error ? cause.message : 'Could not start update')
      setUpdating(false)
    } finally {
      if (updateAbortRef.current === controller) updateAbortRef.current = null
    }
  }

  return (
    <div className="flex max-w-xl flex-col gap-3">
      <section>
        <h3 className="mb-2 text-sm font-semibold text-foreground/85">Remote machine</h3>
        <div className="rounded-xl bg-card px-5">
          <div className="flex items-center gap-4 border-b py-3.5"><span className="flex-1 text-sm font-medium">Host</span><span className="font-mono text-xs text-muted-foreground">{host}</span></div>
          <div className="flex items-center gap-4 py-3.5"><span className="flex-1 text-sm font-medium">Latency</span><span className="text-sm text-muted-foreground">{latency == null ? '—' : `${latency} ms`}</span></div>
        </div>
      </section>
      <section>
        <h3 className="mb-2 text-sm font-semibold text-foreground/85">OpenBot server</h3>
        <div className="rounded-xl bg-card px-5">
          <div className="flex items-center gap-4 border-b py-3.5"><span className="flex-1 text-sm font-medium">Installed version</span><span className="font-mono text-xs text-muted-foreground">{status?.installedVersion ?? '—'}</span></div>
          <div className="flex items-center gap-3 py-3.5"><span className="flex-1 text-sm font-medium">{status?.updateAvailable ? `Update available: ${status.latestVersion}` : 'Status'}</span>{status?.updateAvailable ? <Button size="xs" onClick={update} disabled={updating}><ArrowUp data-icon="inline-start" />{updating ? 'Updating…' : `Update to ${status.latestVersion}`}</Button> : <span className="flex items-center gap-1 text-sm text-success"><Check className="size-4" /> Up to date</span>}<Button size="icon-xs" variant="ghost" onClick={check} disabled={checking} aria-label="Check for updates"><RefreshCw className={cn('size-4', checking && 'animate-spin')} /></Button></div>
        </div>
        <p className="mt-2 px-1 text-xs leading-normal text-muted-foreground/70">Last checked {status?.checkedAt ? new Date(status.checkedAt).toLocaleString() : 'never'}. Updates are checked hourly.</p>
       </section>
       {error && <p className="px-1 text-xs text-destructive">{error}</p>}
    </div>
  )
}
