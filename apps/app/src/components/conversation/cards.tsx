// Structured send-message cards: text, links, widgets, connector, drafts,
// secrets, permissions, cloud-agent.

import { useState } from 'react'
import {
  Check,
  Cloud,
  Copy,
  Eye,
  EyeOff,
  FileText,
  KeyRound,
  Link2,
  Loader2,
  Plug,
  XCircle,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { AgentMarkdown } from './agent-markdown'
import type { Card } from './types'

export function SendMessageCard({ card }: { card: Card }) {
  switch (card.kind) {
    case 'text':
      return (
        <CardShell>
          <div className="border-b px-3 py-2 text-xs font-semibold">{card.title}</div>
          <div className="px-3 py-2">
            <AgentMarkdown markdown={card.body} />
          </div>
        </CardShell>
      )
    case 'links':
      return (
        <CardShell>
          {card.title && (
            <div className="border-b px-3 py-2 text-xs font-semibold">{card.title}</div>
          )}
          {card.links.map((l) => (
            <a
              key={l.url}
              href={l.url}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-2.5 border-b px-3 py-2 last:border-b-0 hover:bg-muted/50"
            >
              <Link2 className="size-3.5 shrink-0 text-info" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium text-foreground">
                  {l.title}
                </span>
                {l.desc && (
                  <span className="block truncate text-[10px] text-muted-foreground">
                    {l.desc}
                  </span>
                )}
              </span>
            </a>
          ))}
        </CardShell>
      )
    case 'widget':
      return (
        <CardShell>
          <div className="border-b px-3 py-2 text-xs font-semibold">{card.title}</div>
          <div className="flex divide-x">
            {card.stats.map((s) => (
              <div key={s.label} className="flex-1 px-3 py-2.5">
                <div className="text-base font-bold tabular-nums">{s.value}</div>
                <div className="text-[10px] text-muted-foreground">{s.label}</div>
              </div>
            ))}
          </div>
        </CardShell>
      )
    case 'connector':
      return (
        <CardShell>
          <div className="flex items-center gap-2.5 px-3 py-2.5">
            <Plug className="size-3.5 text-muted-foreground" />
            <span className="flex-1 text-xs font-semibold">{card.connector}</span>
            <span className="text-[11px] text-muted-foreground">{card.account}</span>
            <Badge
              variant={card.status === 'connected' ? 'success' : 'warning'}
              className="text-[10px]"
            >
              {card.status === 'connected' ? 'Connected' : 'Needs auth'}
            </Badge>
          </div>
        </CardShell>
      )
    case 'draft':
      return (
        <CardShell>
          <div className="flex items-center gap-2 border-b px-3 py-2">
            <FileText className="size-3.5 text-muted-foreground" />
            <span className="flex-1 text-xs font-semibold">{card.title}</span>
            <Badge variant="secondary" className="text-[10px]">
              Draft
            </Badge>
          </div>
          <div className="px-3 py-2 text-xs leading-normal text-muted-foreground">{card.body}</div>
          <div className="flex gap-2 border-t px-3 py-2">
            <Button size="xs">Send draft</Button>
            <Button size="xs" variant="outline">
              Edit
            </Button>
          </div>
        </CardShell>
      )
    case 'secret':
      return <SecretCard name={card.name} value={card.value} />
    case 'permission':
      return <PermissionCard card={card} />
    case 'cloud-agent':
      return (
        <CardShell>
          <div className="flex items-center gap-2.5 px-3 py-2.5">
            <Cloud className="size-3.5 text-info" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-semibold">{card.title}</span>
              <span className="block text-[10px] text-muted-foreground">{card.agent}</span>
            </span>
            {card.status === 'running' && (
              <span className="flex items-center gap-1.5 text-[11px] font-medium text-warning">
                <Loader2 className="size-3 animate-spin" /> Running
              </span>
            )}
            {card.status === 'done' && (
              <span className="flex items-center gap-1.5 text-[11px] font-medium text-success">
                <Check className="size-3" /> Done
              </span>
            )}
            {card.status === 'error' && (
              <span className="flex items-center gap-1.5 text-[11px] font-medium text-destructive">
                <XCircle className="size-3" /> Error
              </span>
            )}
          </div>
        </CardShell>
      )
  }
}

function CardShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="max-w-md min-w-0 overflow-hidden rounded-lg border bg-card/50">{children}</div>
  )
}

function SecretCard({ name, value }: { name: string; value: string }) {
  const [revealed, setRevealed] = useState(false)
  const [copied, setCopied] = useState(false)

  return (
    <CardShell>
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        <KeyRound className="size-3.5 text-warning" />
        <span className="min-w-0 flex-1">
          <span className="block font-mono text-[11px] font-semibold">{name}</span>
          <span className="block truncate font-mono text-[11px] text-muted-foreground">
            {revealed ? value : '•'.repeat(Math.min(value.length, 24))}
          </span>
        </span>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={revealed ? 'Hide secret' : 'Reveal secret'}
          onClick={() => setRevealed((v) => !v)}
        >
          {revealed ? <EyeOff /> : <Eye />}
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Copy secret"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(value)
              setCopied(true)
              setTimeout(() => setCopied(false), 1500)
            } catch {
              // ignore
            }
          }}
        >
          {copied ? <Check className="text-success" /> : <Copy />}
        </Button>
      </div>
    </CardShell>
  )
}

function PermissionCard({ card }: { card: Extract<Card, { kind: 'permission' }> }) {
  const [status, setStatus] = useState(card.status)
  const displayedStatus = card.interactive === false ? card.status : status

  return (
    <CardShell>
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <Badge variant="warning" className="h-4.5 px-1.5 text-[9px] font-bold tracking-widest">
          PERMISSION
        </Badge>
        <span className="min-w-0 flex-1 truncate text-xs font-semibold">{card.action}</span>
      </div>
      <div className="px-3 py-2 text-[11px] leading-normal text-muted-foreground">
        {card.detail}
      </div>
      {displayedStatus === 'pending' && card.interactive !== false ? (
        <div className="flex gap-2 border-t px-3 py-2">
          <Button size="xs" onClick={() => setStatus('approved')}>
            Approve
          </Button>
          <Button size="xs" variant="outline" onClick={() => setStatus('denied')}>
            Deny
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-1.5 border-t px-3 py-2">
          <span
            className={cn(
              'size-1.5 rounded-full',
              displayedStatus === 'approved'
                ? 'bg-success'
                : displayedStatus === 'denied'
                  ? 'bg-destructive'
                  : 'bg-warning',
            )}
          />
          <span
            className={cn(
              'text-[11px] font-medium',
              displayedStatus === 'approved'
                ? 'text-success'
                : displayedStatus === 'denied'
                  ? 'text-destructive'
                  : 'text-warning',
            )}
          >
            {displayedStatus === 'approved'
              ? 'Approved'
              : displayedStatus === 'denied'
                ? 'Denied'
                : 'Pending'}
          </span>
        </div>
      )}
    </CardShell>
  )
}
