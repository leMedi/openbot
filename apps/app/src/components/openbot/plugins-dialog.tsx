import { useState } from 'react'
import { ChevronDown, FileText, Link2, Lock, Plus, RefreshCw, Search } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { BotAvatar } from './bot-avatar'
import { PLUGINS, SKILLS, type Skill } from './data'

export function PluginsDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl">
        <Tabs defaultValue="plugins" className="flex min-h-0 flex-1 flex-col gap-0">
          <div className="flex h-12 shrink-0 items-center justify-center border-b bg-card/50">
            <DialogTitle className="sr-only">Plugins &amp; Skills</DialogTitle>
            <TabsList>
              <TabsTrigger value="plugins" className="px-4">
                Plugins
              </TabsTrigger>
              <TabsTrigger value="skills" className="px-4">
                Skills
              </TabsTrigger>
            </TabsList>
          </div>
          <TabsContent value="plugins" className="min-h-0 flex-1">
            <PluginsTab />
          </TabsContent>
          <TabsContent value="skills" className="min-h-0 flex-1 overflow-y-auto">
            <SkillsTab />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}

function PluginsTab() {
  const [query, setQuery] = useState('')
  const [detailId, setDetailId] = useState('clickup')
  const [installed, setInstalled] = useState<Record<string, boolean>>(
    Object.fromEntries(PLUGINS.map((p) => [p.id, p.installed])),
  )

  const rail = PLUGINS.filter((p) => p.name.toLowerCase().includes(query.toLowerCase()))
  const detail = PLUGINS.find((p) => p.id === detailId) ?? PLUGINS[0]
  const isInstalled = installed[detail.id]

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
          {rail.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setDetailId(p.id)}
              className={cn(
                'flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left',
                p.id === detailId ? 'bg-primary text-white' : 'hover:bg-muted',
              )}
            >
              <BotAvatar name={p.name} color={p.hue} className="size-6 text-[10px]" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{p.name}</span>
                <span
                  className={cn(
                    'block text-[10px]',
                    p.id === detailId ? 'text-white/70' : 'text-muted-foreground',
                  )}
                >
                  {installed[p.id]
                    ? `${p.accounts.length} account${p.accounts.length === 1 ? '' : 's'}`
                    : p.cat}
                </span>
              </span>
              {installed[p.id] && <span className="size-1.5 shrink-0 rounded-full bg-success" />}
            </button>
          ))}
        </div>
      </div>

      {/* Detail */}
      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="max-w-xl px-7 py-6">
          <div className="flex items-start gap-3.5">
            <BotAvatar name={detail.name} color={detail.hue} className="size-13 rounded-lg text-xl" />
            <div className="min-w-0 flex-1">
              <h2 className="text-xl font-bold tracking-tight">{detail.name}</h2>
              <div className="mt-0.5 text-xs text-muted-foreground">MCP · {detail.cat}</div>
            </div>
            <Button
              size="sm"
              variant={isInstalled ? 'outline' : 'default'}
              onClick={() => setInstalled((s) => ({ ...s, [detail.id]: !s[detail.id] }))}
            >
              {isInstalled ? 'Installed ✓' : 'Install'}
            </Button>
          </div>
          <p className="mt-4 text-sm leading-relaxed text-muted-foreground">{detail.blurb}</p>

          <h3 className="mt-6 mb-2 text-[11px] font-semibold text-muted-foreground">Accounts</h3>
          <div className="overflow-hidden rounded-lg border">
            {detail.accounts.map((a) => (
              <div
                key={a.id}
                className="flex items-center gap-2.5 border-b bg-card px-3 py-2.5"
              >
                <span className="flex-1 text-sm">{a.name}</span>
                <span
                  className={cn(
                    'text-[11px] font-medium',
                    a.status === 'connected' ? 'text-success' : 'text-warning',
                  )}
                >
                  {a.status}
                </span>
                <button
                  type="button"
                  className="text-xs text-muted-foreground hover:text-destructive"
                >
                  Disconnect
                </button>
              </div>
            ))}
            <button
              type="button"
              className="flex w-full items-center gap-2 bg-card px-3 py-2.5 text-sm font-medium text-info hover:opacity-80"
            >
              <Plus className="size-3.5" />
              Add Another Account
            </button>
          </div>

          <h3 className="mt-6 mb-2 text-[11px] font-semibold text-muted-foreground">
            Capabilities
          </h3>
          <div className="overflow-hidden rounded-lg border">
            <div className="flex items-center border-b bg-card px-3 py-2.5">
              <span className="flex-1 text-sm">{detail.tools} tools</span>
              <ChevronDown className="size-3.5 text-muted-foreground/70" />
            </div>
            <div className="flex items-center bg-card px-3 py-2.5">
              <span className="flex-1 text-sm">
                {detail.connectors} connector{detail.connectors === 1 ? '' : 's'}
              </span>
              <ChevronDown className="size-3.5 text-muted-foreground/70" />
            </div>
          </div>

          {detail.bundled.length > 0 && (
            <>
              <h3 className="mt-6 mb-2 text-[11px] font-semibold text-muted-foreground">
                Bundled Skills
              </h3>
              <div className="overflow-hidden rounded-lg border">
                {detail.bundled.map((name) => (
                  <div
                    key={name}
                    className="flex items-center gap-2.5 border-b bg-card px-3 py-2.5 last:border-b-0"
                  >
                    <span className="flex size-6 items-center justify-center rounded-md bg-[#7a68d8]/80">
                      <FileText className="size-3 text-white" />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{name}</span>
                    <Lock className="size-3 text-muted-foreground/70" />
                  </div>
                ))}
              </div>
              <p className="mt-1.5 text-[11px] text-muted-foreground/70">
                Included with this plugin to teach bots how to use it.
              </p>
            </>
          )}
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
