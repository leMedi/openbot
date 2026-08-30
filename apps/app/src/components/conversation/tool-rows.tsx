import { useState } from 'react'
import { ChevronRight, Loader2, Wrench, XCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ToolCall, ToolResult } from './types'

export function ToolStatusIcon({
  status,
  className,
}: {
  status: ToolCall['status']
  className?: string
}) {
  if (status === 'pending')
    return <Loader2 className={cn('size-3.5 animate-spin text-muted-foreground', className)} />
  if (status === 'failed') return <XCircle className={cn('size-3.5 text-destructive', className)} />
  return <Wrench className={cn('size-3.5 text-success', className)} />
}

/** Compact expandable tool-call row (not terminal-first output). */
export function ToolCallRow({ call, result }: { call: ToolCall; result?: ToolResult }) {
  const [open, setOpen] = useState(false)

  return (
    <div className="max-w-xl min-w-0 overflow-hidden rounded-lg border bg-card/50">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted/50"
      >
        <ToolStatusIcon status={call.status} />
        <span className="shrink-0 text-xs font-semibold">{call.name}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">
          {call.preview}
        </span>
        <ChevronRight
          className={cn(
            'size-3 shrink-0 text-muted-foreground/70 transition-transform',
            open && 'rotate-90',
          )}
        />
      </button>
      {open && (
        <div className="border-t px-3 py-2.5">
          <p className="text-xs leading-normal text-muted-foreground">
            {call.detail ?? 'No additional details.'}
          </p>
          {result && <ToolResultCard result={result} />}
        </div>
      )}
    </div>
  )
}

/** Tool-result card using native <details>, with bounded scrollable output. */
export function ToolResultCard({ result }: { result: ToolResult }) {
  return (
    <details className="group mt-2 overflow-hidden rounded-lg border bg-background/50">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-2.5 py-1.5 text-[11px] hover:bg-muted/50 [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-3 text-muted-foreground/70 transition-transform group-open:rotate-90" />
        <span className="font-semibold">{result.kind}</span>
        {result.path && (
          <span className="truncate font-mono text-muted-foreground">{result.path}</span>
        )}
        {result.command && (
          <span className="truncate font-mono text-muted-foreground">{result.command}</span>
        )}
        <span className="ml-auto shrink-0 font-medium text-muted-foreground">{result.status}</span>
      </summary>
      <div className="border-t px-2.5 py-2">
        {result.cwd && (
          <div className="mb-1.5 font-mono text-[10px] text-muted-foreground/70">{result.cwd}</div>
        )}
        {result.output && (
          <pre className="max-h-48 overflow-auto rounded-md bg-background/70 px-2.5 py-2 font-mono text-[11px] leading-relaxed text-muted-foreground">
            {result.output}
          </pre>
        )}
        {result.diff && (
          <pre className="mt-1.5 max-h-48 overflow-auto rounded-md bg-background/70 px-2.5 py-2 font-mono text-[11px] leading-relaxed">
            {result.diff.split('\n').map((line, i) => (
              <div
                key={i}
                className={cn(
                  line.startsWith('+') && 'text-success',
                  line.startsWith('-') && 'text-destructive',
                )}
              >
                {line}
              </div>
            ))}
          </pre>
        )}
        {!result.output && !result.diff && (
          <p className="text-[11px] text-muted-foreground">No additional details.</p>
        )}
      </div>
    </details>
  )
}
