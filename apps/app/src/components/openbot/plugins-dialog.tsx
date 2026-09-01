import { useEffect, useState } from 'react'
import type { SafeMcpAccount, SafeMcpServer } from '@openbot/db'
import { FileText, Link2, Plus, RefreshCw, Search, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import {
  addMcpApiKeyAccount,
  addMcpServer,
  changeMcpServer,
  removeMcpAccount,
  removeMcpServer,
} from '@/server/mcp'
import { BotAvatar } from './bot-avatar'
import { SKILLS, type Skill } from './data'

export function PluginsDialog({
  open,
  onOpenChange,
  servers,
  accounts,
  onChanged,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  servers: SafeMcpServer[]
  accounts: SafeMcpAccount[]
  onChanged: () => Promise<unknown>
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl">
        <Tabs defaultValue="plugins" className="flex min-h-0 flex-1 flex-col gap-0">
          <div className="flex h-12 shrink-0 items-center justify-center border-b bg-card/50">
            <DialogTitle className="sr-only">Plugins &amp; Skills</DialogTitle>
            <TabsList>
              <TabsTrigger value="plugins">Plugins</TabsTrigger>
              <TabsTrigger value="skills">Skills</TabsTrigger>
            </TabsList>
          </div>
          <TabsContent value="plugins" className="min-h-0 flex-1">
            <PluginsTab servers={servers} accounts={accounts} onChanged={onChanged} />
          </TabsContent>
          <TabsContent value="skills" className="min-h-0 flex-1 overflow-y-auto">
            <SkillsTab />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}

type McpDraft = {
  name: string
  serverKey: string
  url: string
  apiKeyHeader: string
  apiKeyPrefix: 'Bearer' | ''
}

function configurationOf(server: SafeMcpServer) {
  const value = server.configurationJson as Record<string, unknown>
  return {
    url: typeof value.url === 'string' ? value.url : '',
    apiKeyHeader:
      typeof value.apiKeyHeader === 'string' ? value.apiKeyHeader : 'Authorization',
    apiKeyPrefix: (value.apiKeyPrefix === '' ? '' : 'Bearer') as 'Bearer' | '',
  }
}

function draftOf(server?: SafeMcpServer): McpDraft {
  const configuration = server ? configurationOf(server) : undefined
  return {
    name: server?.name ?? '',
    serverKey: server?.serverKey ?? '',
    url: configuration?.url ?? '',
    apiKeyHeader: configuration?.apiKeyHeader ?? 'Authorization',
    apiKeyPrefix: configuration?.apiKeyPrefix ?? 'Bearer',
  }
}

function PluginsTab({
  servers,
  accounts,
  onChanged,
}: {
  servers: SafeMcpServer[]
  accounts: SafeMcpAccount[]
  onChanged: () => Promise<unknown>
}) {
  const [query, setQuery] = useState('')
  const [detailId, setDetailId] = useState(servers[0]?.id ?? '')
  const [creatingServer, setCreatingServer] = useState(servers.length === 0)
  const [draft, setDraft] = useState<McpDraft | null>(servers.length === 0 ? draftOf() : null)
  const [accountDraft, setAccountDraft] = useState({ label: '', apiKey: '' })
  const [addingAccount, setAddingAccount] = useState<'api_key' | 'oauth' | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const detail = creatingServer
    ? undefined
    : servers.find((server) => server.id === detailId)
  const rail = servers.filter((server) =>
    server.name.toLowerCase().includes(query.toLowerCase()),
  )
  const detailAccounts = accounts.filter((account) => account.serverId === detail?.id)

  useEffect(() => {
    if (creatingServer) return
    if (!detailId && servers[0]) setDetailId(servers[0].id)
    if (detailId && !servers.some((server) => server.id === detailId)) {
      setDetailId(servers[0]?.id ?? '')
    }
  }, [creatingServer, detailId, servers])

  async function saveServer() {
    if (!draft || saving) return
    setSaving(true)
    setError('')
    try {
      const input = {
        serverKey: draft.serverKey,
        name: draft.name,
        transport: 'streamable_http' as const,
        configuration: {
          version: 1 as const,
          url: draft.url,
          apiKeyHeader: draft.apiKeyHeader,
          apiKeyPrefix: draft.apiKeyPrefix,
        },
      }
      const saved = detail && !creatingServer
        ? await changeMcpServer({ data: { id: detail.id, patch: input } })
        : await addMcpServer({ data: input })
      await onChanged()
      setDetailId(saved.id)
      setCreatingServer(false)
      setDraft(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save the MCP server')
    } finally {
      setSaving(false)
    }
  }

  async function deleteServer(server: SafeMcpServer) {
    if (
      !window.confirm(
        `Remove ${server.name}? Its accounts and every agent grant will also be removed.`,
      )
    ) {
      return
    }
    setSaving(true)
    setError('')
    try {
      await removeMcpServer({ data: { id: server.id } })
      setDetailId('')
      await onChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not remove the MCP server')
    } finally {
      setSaving(false)
    }
  }

  async function addAccount() {
    if (!detail || saving) return
    setSaving(true)
    setError('')
    try {
      await addMcpApiKeyAccount({
        data: {
          serverId: detail.id,
          label: accountDraft.label,
          apiKey: accountDraft.apiKey,
        },
      })
      setAccountDraft({ label: '', apiKey: '' })
      setAddingAccount(null)
      await onChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not add the MCP account')
    } finally {
      setSaving(false)
    }
  }

  function connectOauthAccount() {
    if (!detail || saving || !accountDraft.label.trim()) return
    setSaving(true)
    const authorization = new URL('/api/mcp/oauth/start', window.location.origin)
    authorization.searchParams.set('serverId', detail.id)
    authorization.searchParams.set('label', accountDraft.label)
    window.location.assign(authorization)
  }

  async function deleteAccount(account: SafeMcpAccount) {
    if (!window.confirm(`Remove account ${account.label}? Agent access will be revoked.`)) return
    setSaving(true)
    setError('')
    try {
      await removeMcpAccount({ data: { id: account.id } })
      await onChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not remove the MCP account')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex h-full min-h-0">
      {/* Rail */}
      <div className="flex w-64 shrink-0 flex-col border-r bg-sidebar/70">
        <div className="p-2.5 pb-2">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search MCPs"
              className="h-7.5 pl-7 text-sm"
            />
          </div>
        </div>
        <div className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-2 pb-3">
          {rail.map((server) => (
            <button
              key={server.id}
              type="button"
              onClick={() => {
                setDetailId(server.id)
                setCreatingServer(false)
                setDraft(null)
              }}
              className={cn(
                'flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left',
                server.id === detailId ? 'bg-primary text-white' : 'hover:bg-muted',
              )}
            >
              <BotAvatar name={server.name} color="#3b82f6" className="size-6 text-[10px]" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{server.name}</span>
                <span
                  className={cn(
                    'block text-[10px]',
                    server.id === detailId ? 'text-white/70' : 'text-muted-foreground',
                  )}
                >
                  {accounts.filter((account) => account.serverId === server.id).length} accounts
                </span>
              </span>
              <span
                className={cn(
                  'size-1.5 shrink-0 rounded-full',
                  server.enabled ? 'bg-success' : 'bg-muted-foreground/40',
                )}
              />
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              setDetailId('')
              setCreatingServer(true)
              setDraft(draftOf())
            }}
            className="mt-1 flex items-center gap-2 rounded-lg px-2 py-2 text-sm font-medium text-info hover:bg-muted"
          >
            <Plus className="size-3.5" /> Add MCP server
          </button>
        </div>
      </div>

      {/* Detail */}
      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="max-w-xl px-7 py-6">
          {draft ? (
            <div>
              <h2 className="text-xl font-bold tracking-tight">
                {detail ? `Edit ${detail.name}` : 'Add MCP server'}
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Streamable HTTP configuration is visible to the app. Put secrets only in accounts.
              </p>
              <div className="mt-5 grid gap-3">
                <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Server name" />
                <Input value={draft.serverKey} onChange={(e) => setDraft({ ...draft, serverKey: e.target.value })} placeholder="Stable key, e.g. clickup" />
                <Input value={draft.url} onChange={(e) => setDraft({ ...draft, url: e.target.value })} placeholder="https://example.com/mcp" />
                <div className="grid grid-cols-2 gap-3">
                  <Input value={draft.apiKeyHeader} onChange={(e) => setDraft({ ...draft, apiKeyHeader: e.target.value })} placeholder="Authorization" />
                  <select
                    value={draft.apiKeyPrefix}
                    onChange={(e) => setDraft({ ...draft, apiKeyPrefix: e.target.value as 'Bearer' | '' })}
                    className="h-8 rounded-lg border border-input bg-background px-2.5 text-sm"
                  >
                    <option value="Bearer">Bearer prefix</option>
                    <option value="">No prefix</option>
                  </select>
                </div>
              </div>
              <div className="mt-4 flex justify-end gap-2">
                {detail && <Button variant="ghost" size="sm" onClick={() => setDraft(null)}>Cancel</Button>}
                <Button size="sm" disabled={saving || !draft.name.trim() || !draft.serverKey.trim() || !draft.url.trim()} onClick={() => void saveServer()}>
                  {saving ? 'Saving…' : 'Save Server'}
                </Button>
              </div>
            </div>
          ) : detail ? (
            <div>
              <div className="flex items-start gap-3.5">
                <BotAvatar name={detail.name} color="#3b82f6" className="size-13 rounded-lg text-xl" />
                <div className="min-w-0 flex-1">
                  <h2 className="text-xl font-bold tracking-tight">{detail.name}</h2>
                  <div className="mt-0.5 text-xs text-muted-foreground">{detail.serverKey} · Streamable HTTP</div>
                </div>
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  {detail.enabled ? 'Enabled' : 'Disabled'}
                  <Switch checked={detail.enabled} disabled={saving} onCheckedChange={(enabled) => void changeMcpServer({ data: { id: detail.id, patch: { enabled } } }).then(onChanged).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Could not update server'))} />
                </label>
              </div>
              <div className="mt-4 rounded-lg border bg-card px-3 py-2.5 text-xs text-muted-foreground">
                {configurationOf(detail).url}
              </div>
              <div className="mt-3 flex gap-2">
                <Button size="sm" variant="outline" onClick={() => setDraft(draftOf(detail))}>Edit Server</Button>
                <Button size="sm" variant="destructive-outline" disabled={saving} onClick={() => void deleteServer(detail)}><Trash2 /> Remove</Button>
              </div>

              <h3 className="mt-6 mb-2 text-[11px] font-semibold text-muted-foreground">Accounts</h3>
              <div className="overflow-hidden rounded-lg border">
                {detailAccounts.map((account) => (
                  <div key={account.id} className="flex items-center gap-2.5 border-b bg-card px-3 py-2.5 last:border-b-0">
                    <span className="flex-1 text-sm">{account.label}</span>
                    <Badge variant="secondary" className="text-[10px]">
                      {account.authType === 'oauth' ? 'OAuth' : 'API key'}
                    </Badge>
                    <span className="text-[11px] font-medium text-success">{account.status}</span>
                    <Button variant="ghost" size="icon-xs" aria-label={`Remove ${account.label}`} disabled={saving} onClick={() => void deleteAccount(account)}><Trash2 /></Button>
                  </div>
                ))}
                {detailAccounts.length === 0 && !addingAccount && <p className="bg-card px-3 py-3 text-xs text-muted-foreground">No accounts configured.</p>}
                {addingAccount ? (
                  <div className="space-y-2 bg-card p-3">
                    <Input value={accountDraft.label} onChange={(e) => setAccountDraft({ ...accountDraft, label: e.target.value })} placeholder="Account label" />
                    {addingAccount === 'api_key' && <Input type="password" autoComplete="new-password" value={accountDraft.apiKey} onChange={(e) => setAccountDraft({ ...accountDraft, apiKey: e.target.value })} placeholder="API key" />}
                    {addingAccount === 'oauth' && <p className="text-xs text-muted-foreground">You will continue to the provider to authorize this account.</p>}
                    <div className="flex justify-end gap-2">
                      <Button size="sm" variant="ghost" onClick={() => { setAddingAccount(null); setAccountDraft({ label: '', apiKey: '' }) }}>Cancel</Button>
                      {addingAccount === 'api_key' ? (
                        <Button size="sm" disabled={saving || !accountDraft.label.trim() || !accountDraft.apiKey} onClick={() => void addAccount()}>Add Account</Button>
                      ) : (
                        <Button size="sm" disabled={saving || !accountDraft.label.trim()} onClick={connectOauthAccount}>Connect OAuth</Button>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 divide-x border-t bg-card">
                    <button type="button" onClick={() => setAddingAccount('api_key')} className="flex items-center justify-center gap-2 px-3 py-2.5 text-sm font-medium text-info hover:bg-muted/50">
                      <Plus className="size-3.5" /> Add API key
                    </button>
                    <button type="button" onClick={() => setAddingAccount('oauth')} className="flex items-center justify-center gap-2 px-3 py-2.5 text-sm font-medium text-info hover:bg-muted/50">
                      <Link2 className="size-3.5" /> Connect OAuth
                    </button>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Add an MCP server to get started.</p>
          )}
          {error && <p className="mt-4 text-xs text-destructive">{error}</p>}
        </div>
      </div>
    </div>
  )
}

function SkillsTab() {
  const [skills, setSkills] = useState<Skill[]>(SKILLS)
  const [addMode, setAddMode] = useState<'none' | 'link' | 'manual'>('none')
  const [detailId, setDetailId] = useState<string | null>(null)

  const detail = detailId ? skills.find((s) => s.id === detailId) : null

  function toggle(id: string) {
    setSkills((all) => all.map((s) => (s.id === id ? { ...s, enabled: !s.enabled } : s)))
  }

  if (detail) {
    return (
      <div className="mx-auto max-w-xl px-7 py-6">
        <button
          type="button"
          onClick={() => setDetailId(null)}
          className="mb-4 inline-flex items-center gap-1 text-xs font-medium text-info hover:opacity-80"
        >
          ‹ Skills
        </button>
        <div className="flex items-start gap-3.5">
          <span
            className={cn(
              'flex size-11 shrink-0 items-center justify-center rounded-md bg-[#7a68d8]',
              !detail.enabled && 'opacity-50',
            )}
          >
            <FileText className="size-4.5 text-white" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-bold tracking-tight">{detail.name}</h2>
            <div className="mt-0.5 text-xs text-muted-foreground">{detail.origin}</div>
          </div>
          <label className="flex items-center gap-2 pt-1 text-[11px] font-medium text-muted-foreground">
            {detail.enabled ? 'Enabled' : 'Disabled'}
            <Switch checked={detail.enabled} onCheckedChange={() => toggle(detail.id)} />
          </label>
        </div>
        <p className="mt-3.5 text-sm leading-relaxed text-muted-foreground">{detail.desc}</p>
        <div className="mt-5 mb-2 flex items-baseline">
          <h3 className="flex-1 text-[11px] font-semibold text-muted-foreground">Instructions</h3>
          <span className="text-[10px] font-semibold tracking-wider text-muted-foreground/70">
            MARKDOWN
          </span>
        </div>
        <pre className="rounded-lg border bg-background/60 px-4 py-3.5 font-mono text-xs leading-relaxed whitespace-pre-wrap">
          {detail.md}
        </pre>
        <div className="mt-4 flex justify-end gap-2">
          {detail.source === 'link' && (
            <Button variant="outline" size="sm">
              <RefreshCw data-icon="inline-start" /> Refresh
            </Button>
          )}
          <Button
            variant="destructive-outline"
            size="sm"
            onClick={() => {
              setSkills((all) => all.filter((s) => s.id !== detail.id))
              setDetailId(null)
            }}
          >
            Remove Skill
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-xl px-7 py-6">
      <div className="flex items-start gap-3.5">
        <div className="min-w-0 flex-1">
          <h2 className="text-xl font-bold tracking-tight">Skills</h2>
          <p className="mt-1 text-xs leading-normal text-muted-foreground">
            Reusable task playbooks any bot can run. Add one from a link, or paste the markdown
            directly.
          </p>
        </div>
        <span className="pt-1.5 text-[11px] font-semibold whitespace-nowrap text-muted-foreground/70">
          {skills.length} installed
        </span>
      </div>

      {addMode === 'none' && (
        <div className="mt-5 flex gap-2.5">
          <button
            type="button"
            onClick={() => setAddMode('link')}
            className="flex-1 rounded-lg border bg-card px-4 py-3.5 text-left hover:border-info/50"
          >
            <span className="flex items-center gap-2">
              <Link2 className="size-3.5 text-info" />
              <span className="text-sm font-semibold">Add from a link</span>
            </span>
            <span className="mt-1 block text-xs text-muted-foreground">
              Import a skill from a gist, doc, or .md URL.
            </span>
          </button>
          <button
            type="button"
            onClick={() => setAddMode('manual')}
            className="flex-1 rounded-lg border bg-card px-4 py-3.5 text-left hover:border-info/50"
          >
            <span className="flex items-center gap-2">
              <FileText className="size-3.5 text-info" />
              <span className="text-sm font-semibold">Add manually</span>
            </span>
            <span className="mt-1 block text-xs text-muted-foreground">
              Write title, description and instructions.
            </span>
          </button>
        </div>
      )}

      {addMode === 'link' && (
        <div className="mt-5 rounded-lg border border-primary/45 bg-card px-4 py-3.5">
          <div className="text-xs font-semibold">Add from a link</div>
          <div className="mt-2.5 flex gap-2">
            <Input placeholder="https://… (gist, doc, or .md file)" className="text-xs" />
            <Button size="sm" onClick={() => setAddMode('none')}>
              Add Skill
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setAddMode('none')}>
              Cancel
            </Button>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground/70">
            Fetched once when added — refresh anytime.
          </p>
        </div>
      )}

      {addMode === 'manual' && (
        <div className="mt-5 rounded-lg border border-primary/45 bg-card px-4 py-3.5">
          <div className="text-xs font-semibold">Add manually</div>
          <label className="mt-3 block text-[11px] font-semibold text-muted-foreground">
            Title
          </label>
          <Input placeholder="e.g. Escalate stuck tasks" className="mt-1.5 text-xs" />
          <label className="mt-3 block text-[11px] font-semibold text-muted-foreground">
            Description
          </label>
          <Input
            placeholder="One line on when a bot should use this skill"
            className="mt-1.5 text-xs"
          />
          <div className="mt-3 flex items-baseline">
            <label className="flex-1 text-[11px] font-semibold text-muted-foreground">
              Instructions
            </label>
            <span className="text-[10px] font-semibold tracking-wider text-muted-foreground/70">
              MARKDOWN
            </span>
          </div>
          <Textarea
            placeholder={
              '1. Find tasks idle for 5+ days\n2. Ping the assignee in Slack\n3. If no reply in 24h, escalate to the lead'
            }
            className="mt-1.5 min-h-32 font-mono text-xs"
          />
          <div className="mt-3 flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setAddMode('none')}>
              Cancel
            </Button>
            <Button size="sm" onClick={() => setAddMode('none')}>
              Add Skill
            </Button>
          </div>
        </div>
      )}

      <h3 className="mt-6 mb-2 text-[11px] font-semibold text-muted-foreground">
        Installed Skills
      </h3>
      <div className="overflow-hidden rounded-lg border">
        {skills.map((sk) => (
          <div
            key={sk.id}
            className="flex cursor-pointer items-center gap-2.5 border-b bg-card px-3 py-2.5 last:border-b-0 hover:bg-card/60"
            onClick={() => setDetailId(sk.id)}
          >
            <span
              className={cn(
                'flex size-6 shrink-0 items-center justify-center rounded-md bg-[#7a68d8]',
                !sk.enabled && 'opacity-40',
              )}
            >
              <FileText className="size-3 text-white" />
            </span>
            <span className="min-w-0 flex-1">
              <span
                className={cn(
                  'block truncate text-sm font-medium',
                  !sk.enabled && 'text-muted-foreground',
                )}
              >
                {sk.name}
              </span>
              <span className="block truncate text-[10px] text-muted-foreground/70">
                {sk.origin}
              </span>
            </span>
            <Badge variant={sk.source === 'link' ? 'info' : 'secondary'} className="text-[10px]">
              {sk.source === 'link' ? 'Link' : 'Manual'}
            </Badge>
            {sk.source === 'link' && (
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label="Refresh from link"
                onClick={(e) => e.stopPropagation()}
              >
                <RefreshCw />
              </Button>
            )}
            <span onClick={(e) => e.stopPropagation()}>
              <Switch
                size="sm"
                checked={sk.enabled}
                onCheckedChange={() => toggle(sk.id)}
              />
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
