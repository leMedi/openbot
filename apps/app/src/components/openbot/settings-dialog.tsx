import { useEffect, useRef, useState } from 'react'
import type {
  ProviderAuthFlowEvent,
  ProviderConfigurationDto,
  ProviderDto,
} from '@openbot/agent'
import type { Profile, Setting } from '@openbot/db'
import {
  ArrowUp,
  ExternalLink,
  Plus,
  Check,
  RefreshCw,
  Server,
  SlidersHorizontal,
  Sun,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { saveUserProfile } from '@/server/profile'
import {
  disconnectAiProvider,
  getAiProviders,
  refreshAiProviders,
  saveAiModelSettings,
} from '@/server/providers'
import { BotAvatar } from './bot-avatar'
import {
  checkServerUpdate,
  getServerConfig,
  getServerUpdate,
  startServerUpdate,
} from '@/server/config'

type Tab = 'general' | 'providers' | 'server'

const TABS: { id: Tab; label: string; icon: typeof Sun; group: string }[] = [
  { id: 'general', label: 'General', icon: SlidersHorizontal, group: 'Account' },
  { id: 'providers', label: 'Providers', icon: Sun, group: 'Connection' },
  { id: 'server', label: 'Server', icon: Server, group: 'Connection' },
]

export function SettingsDialog({
  open,
  onOpenChange,
  profile,
  onProfileSaved,
  providerConfiguration,
  onProvidersChanged,
  onServerUpdateStatus,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  profile: Profile
  onProfileSaved: (profile: Profile) => void
  providerConfiguration: ProviderConfigurationDto & { setting: Setting }
  onProvidersChanged: () => void
  onServerUpdateStatus: (updateAvailable: boolean) => void
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
        </div>
      </DialogContent>
    </Dialog>
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

type ActiveAuthFlow = {
  providerId: string
  providerName: string
  flowId: string
  prompt?: Extract<ProviderAuthFlowEvent, { type: 'prompt' }>
  notifications: Extract<ProviderAuthFlowEvent, { type: 'notification' }>[]
  error?: string
}

function ProvidersTab({
  initialConfiguration,
  onChanged,
}: {
  initialConfiguration: ProviderView
  onChanged: () => void
}) {
  const [configuration, setConfiguration] = useState(initialConfiguration)
  const [authChoicesFor, setAuthChoicesFor] = useState<string | null>(null)
  const [flow, setFlow] = useState<ActiveAuthFlow | null>(null)
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

  const connected = configuration.providers.filter((provider) => provider.connected)
  const available = configuration.providers.filter((provider) => !provider.connected)
  const modelOptions = configuration.models

  async function reload() {
    const updated = await getAiProviders()
    setConfiguration(updated)
    onChanged()
  }

  async function startLogin(provider: ProviderDto, authType: 'api_key' | 'oauth') {
    setBusy(true)
    setError(null)
    setAuthChoicesFor(null)
    try {
      const response = await fetch(`/api/providers/${encodeURIComponent(provider.id)}/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ authType }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error ?? 'Provider login could not start')

      const nextFlow: ActiveAuthFlow = {
        providerId: provider.id,
        providerName: provider.name,
        flowId: body.flowId,
        notifications: [],
      }
      setFlow(nextFlow)
      flowIdRef.current = body.flowId
      const source = new EventSource(`/api/provider-auth-flows/${body.flowId}/stream`)
      eventSourceRef.current = source
      source.onmessage = (message) => {
        const event = JSON.parse(message.data) as ProviderAuthFlowEvent
        if (event.type === 'prompt') {
          setAnswer('')
          setFlow((current) => current ? { ...current, prompt: event } : current)
        } else if (event.type === 'prompt_answered') {
          setFlow((current) => current?.prompt?.promptId === event.promptId
            ? { ...current, prompt: undefined }
            : current)
        } else if (event.type === 'notification') {
          setFlow((current) => current
            ? { ...current, notifications: [...current.notifications, event] }
            : current)
        } else if (event.type === 'complete') {
          source.close()
          eventSourceRef.current = null
          flowIdRef.current = null
          setFlow(null)
          void reload().catch((cause) => setError(
            cause instanceof Error ? cause.message : 'Provider list could not be reloaded',
          ))
        } else if (event.type === 'error') {
          source.close()
          eventSourceRef.current = null
          flowIdRef.current = null
          setFlow((current) => current ? { ...current, error: event.message } : current)
        }
      }
      source.onerror = () => {
        if (eventSourceRef.current !== source) return
        source.close()
        eventSourceRef.current = null
        setFlow((current) => current
          ? { ...current, error: 'The provider login connection closed unexpectedly' }
          : current)
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Provider login could not start')
    } finally {
      setBusy(false)
    }
  }

  async function submitPrompt() {
    if (!flow?.prompt) return
    setBusy(true)
    try {
      const response = await fetch(`/api/provider-auth-flows/${flow.flowId}/respond`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ promptId: flow.prompt.promptId, value: answer }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error ?? 'Login response was rejected')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Login response was rejected')
    } finally {
      setBusy(false)
    }
  }

  async function cancelFlow() {
    if (!flow) return
    eventSourceRef.current?.close()
    eventSourceRef.current = null
    flowIdRef.current = null
    await fetch(`/api/provider-auth-flows/${flow.flowId}`, { method: 'DELETE' })
    setFlow(null)
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

      <h3 className="text-sm font-semibold text-foreground/85">Connected providers</h3>
      {connected.length > 0 ? (
        <div className="rounded-xl bg-card px-5">
          {connected.map((provider) => (
            <div key={provider.id} className="border-b py-4 last:border-b-0">
              <div className="flex items-center gap-3">
                <BotAvatar name={provider.name} color={providerHue(provider.id)} className="size-6.5 text-xs" />
                <span className="text-sm font-semibold">{provider.name}</span>
                <Badge variant="outline" className="text-[10px]">
                  {provider.connectionSource ?? 'connected'}
                </Badge>
                <span className="text-[10px] text-muted-foreground">
                  {provider.modelCount} models
                </span>
                <span className="flex-1" />
                {provider.authMethods.length > 0 && (
                  <button
                    type="button"
                    disabled={busy || !!flow}
                    onClick={() => setAuthChoicesFor((current) =>
                      current === provider.id ? null : provider.id
                    )}
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
              {authChoicesFor === provider.id && (
                <div className="mt-2.5 ml-9 flex flex-wrap gap-2">
                  {provider.authMethods.map((method) => (
                    <Button
                      key={method.type}
                      size="sm"
                      variant="outline"
                      onClick={() => void startLogin(provider, method.type)}
                    >
                      {method.label}
                    </Button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-xl bg-card px-5 py-5 text-xs text-muted-foreground/70">
          No providers connected yet.
        </div>
      )}

      <h3 className="mt-3 text-sm font-semibold text-foreground/85">Available providers</h3>
      <div className="rounded-xl bg-card px-5">
        {available.map((provider) => (
          <ProviderRow
            key={provider.id}
            provider={provider}
            choosing={authChoicesFor === provider.id}
            busy={busy || !!flow}
            onChoose={() => setAuthChoicesFor((current) =>
              current === provider.id ? null : provider.id
            )}
            onLogin={(authType) => void startLogin(provider, authType)}
          />
        ))}
      </div>
      {flow && (
        <AuthFlowPanel
          flow={flow}
          answer={answer}
          busy={busy}
          onAnswer={setAnswer}
          onSubmit={() => void submitPrompt()}
          onCancel={() => void cancelFlow()}
        />
      )}
      {(error || configuration.error) && (
        <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {error ?? configuration.error}
        </p>
      )}
    </div>
  )
}

function ProviderRow({
  provider,
  choosing,
  busy,
  onChoose,
  onLogin,
}: {
  provider: ProviderDto
  choosing: boolean
  busy: boolean
  onChoose: () => void
  onLogin: (authType: 'api_key' | 'oauth') => void
}) {
  return (
    <div className="flex items-start gap-3 border-b py-4 last:border-b-0">
      <BotAvatar
        name={provider.name}
        color={providerHue(provider.id)}
        className="mt-0.5 size-6.5 text-xs"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">{provider.name}</span>
          <Badge variant="outline" className="text-[10px]">{provider.modelCount} models</Badge>
        </div>
        <p className="mt-1 text-xs leading-normal text-muted-foreground">
          {provider.authMethods.length > 0
            ? provider.authMethods.map((method) => method.label).join(' or ')
            : 'Requires credentials configured on the server.'}
        </p>
        {choosing && provider.authMethods.length > 0 && (
          <div className="mt-2.5 flex flex-wrap gap-2">
            {provider.authMethods.map((method) => (
              <Button key={method.type} size="sm" variant="outline" onClick={() => onLogin(method.type)}>
                {method.label}
              </Button>
            ))}
          </div>
        )}
      </div>
      {!choosing && provider.authMethods.length > 0 && (
        <Button size="sm" variant="outline" disabled={busy} onClick={onChoose}>
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
    <label className="flex min-w-0 flex-col gap-1.5 text-xs font-medium">
      {label}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-8 min-w-0 rounded-lg border border-input bg-transparent px-2 text-xs outline-none dark:bg-input/30"
      >
        {value && !models.some((model) => model.key === value) && (
          <option value={value}>{value} (unavailable)</option>
        )}
        {models.map((model) => (
          <option key={model.key} value={model.key}>
            {model.providerName} — {model.name}
          </option>
        ))}
      </select>
    </label>
  )
}

function AuthFlowPanel({
  flow,
  answer,
  busy,
  onAnswer,
  onSubmit,
  onCancel,
}: {
  flow: ActiveAuthFlow
  answer: string
  busy: boolean
  onAnswer: (answer: string) => void
  onSubmit: () => void
  onCancel: () => void
}) {
  const prompt = flow.prompt?.prompt
  return (
    <div className="rounded-xl border bg-card px-5 py-4">
      <div className="flex items-center gap-2">
        <span className="flex-1 text-sm font-semibold">Connect {flow.providerName}</span>
        <Button size="xs" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
      <div className="mt-3 flex flex-col gap-2 text-xs text-muted-foreground">
        {flow.notifications.map(({ notification }, index) => (
          <div key={`${notification.type}-${index}`}>
            {notification.type === 'auth_url' ? (
              <div className="flex flex-col gap-1">
                {notification.instructions && <span>{notification.instructions}</span>}
                <a
                  href={notification.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-info hover:underline"
                >
                  Open sign-in page <ExternalLink className="size-3" />
                </a>
              </div>
            ) : notification.type === 'device_code' ? (
              <div>
                Open <a className="text-info hover:underline" href={notification.verificationUri} target="_blank" rel="noreferrer">{notification.verificationUri}</a>
                {' '}and enter <code className="rounded bg-muted px-1 py-0.5 text-foreground">{notification.userCode}</code>
              </div>
            ) : notification.type === 'info' ? (
              <div className="flex flex-col gap-1">
                <span>{notification.message}</span>
                {notification.links?.map((link) => (
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
            ) : (
              <div>{notification.message}</div>
            )}
          </div>
        ))}
        {prompt && (
          <div className="mt-1 flex flex-col gap-2">
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
            <div><Button size="sm" disabled={busy || !answer} onClick={onSubmit}>Continue</Button></div>
          </div>
        )}
        {!prompt && !flow.error && <div>Waiting for the provider…</div>}
        {flow.error && <div className="text-destructive">{flow.error}</div>}
      </div>
    </div>
  )
}

function providerHue(providerId: string) {
  let hash = 0
  for (const character of providerId) hash = (hash * 31 + character.charCodeAt(0)) | 0
  return `hsl(${Math.abs(hash) % 360} 42% 48%)`
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
