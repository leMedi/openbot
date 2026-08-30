import { useState } from 'react'
import { Check, Copy } from 'lucide-react'

/** Fenced code block with a Copy code action. */
export function CodeBlock({ code, language }: { code: string; language?: string }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // clipboard unavailable — ignore
    }
  }

  return (
    <div className="group/code relative my-2 overflow-hidden rounded-lg border bg-background/60">
      <div className="flex items-center border-b bg-card/50 px-3 py-1">
        <span className="flex-1 font-mono text-[10px] text-muted-foreground">
          {language ?? 'text'}
        </span>
        <button
          type="button"
          onClick={copy}
          aria-label="Copy code"
          className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          {copied ? <Check className="size-3 text-success" /> : <Copy className="size-3" />}
          {copied ? 'Copied' : 'Copy code'}
        </button>
      </div>
      <pre className="max-h-72 overflow-auto px-3 py-2.5 font-mono text-xs leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  )
}
