// AgentMessageContent — custom markdown rendering per conversation-spec.md.
// Loaded lazily (agent-markdown.tsx) so KaTeX/Mermaid stay out of the main chunk.

import type { ComponentProps } from 'react'
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown'
import rehypeKatex from 'rehype-katex'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import { Hash } from 'lucide-react'
import 'katex/dist/katex.min.css'
import { CodeBlock } from './code-block'
import { MermaidViewer } from './mermaid-viewer'

/** Only allow http(s) destinations; anything else renders as plain text. */
function urlTransform(url: string) {
  return /^https?:\/\//i.test(url) ? defaultUrlTransform(url) : undefined
}

function Pre(props: ComponentProps<'pre'>) {
  // Fenced blocks are fully rendered by the `code` component below.
  return <>{props.children}</>
}

function Code({ className, children, node, ...props }: ComponentProps<'code'> & { node?: unknown }) {
  const language = /language-(\w+)/.exec(className ?? '')?.[1]
  const raw = String(children ?? '').replace(/\n$/, '')
  const isBlock = language !== undefined || raw.includes('\n')
  if (!isBlock) {
    return (
      <code
        className="rounded-sm bg-muted px-1 py-0.5 font-mono text-[0.85em] text-foreground/90"
        {...props}
      >
        {children}
      </code>
    )
  }
  if (language === 'mermaid') return <MermaidViewer code={raw} />
  return <CodeBlock code={raw} language={language} />
}

const components = {
  pre: Pre,
  code: Code,
  h1: (p: ComponentProps<'h1'>) => (
    <h1 className="mt-3 mb-1.5 text-base font-bold first:mt-0" {...p} />
  ),
  h2: (p: ComponentProps<'h2'>) => (
    <h2 className="mt-3 mb-1.5 text-[15px] font-bold first:mt-0" {...p} />
  ),
  h3: (p: ComponentProps<'h3'>) => (
    <h3 className="mt-2.5 mb-1 text-sm font-bold first:mt-0" {...p} />
  ),
  p: (p: ComponentProps<'p'>) => <p className="my-1.5 first:mt-0 last:mb-0" {...p} />,
  ul: (p: ComponentProps<'ul'>) => (
    <ul className="my-1.5 flex list-disc flex-col gap-0.5 pl-5" {...p} />
  ),
  ol: (p: ComponentProps<'ol'>) => (
    <ol className="my-1.5 flex list-decimal flex-col gap-0.5 pl-5" {...p} />
  ),
  li: (p: ComponentProps<'li'>) => <li className="[&>p]:my-0" {...p} />,
  input: (p: ComponentProps<'input'>) =>
    p.type === 'checkbox' ? (
      // Task-list markers render read-only.
      <input {...p} disabled readOnly className="mr-1.5 size-3 accent-primary" />
    ) : (
      <input {...p} />
    ),
  blockquote: (p: ComponentProps<'blockquote'>) => (
    <blockquote
      className="my-2 border-l-2 border-primary/60 pl-3 text-muted-foreground italic"
      {...p}
    />
  ),
  hr: () => <hr className="my-3 border-border" />,
  table: (p: ComponentProps<'table'>) => (
    <div className="my-2 overflow-x-auto rounded-lg border">
      <table className="w-full border-collapse text-xs" {...p} />
    </div>
  ),
  th: (p: ComponentProps<'th'>) => (
    <th className="border-b bg-card/60 px-2.5 py-1.5 text-left font-semibold" {...p} />
  ),
  td: (p: ComponentProps<'td'>) => (
    <td className="border-b px-2.5 py-1.5 last:border-b-0" {...p} />
  ),
  a: (p: ComponentProps<'a'>) => (
    <a
      {...p}
      target="_blank"
      rel="noreferrer"
      className="text-info underline-offset-2 hover:underline"
    />
  ),
  img: (p: ComponentProps<'img'>) => (
    <img {...p} className="my-2 max-h-64 max-w-full rounded-lg border" />
  ),
}

export type AgentMessageContentProps = {
  markdown: string
  images?: string[]
  channel?: string
}

export default function AgentMessageContent({
  markdown,
  images,
  channel,
}: AgentMessageContentProps) {
  return (
    <div className="min-w-0 text-sm leading-relaxed">
      {channel && (
        <span className="mb-1.5 inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
          <Hash className="size-2.5" />
          {channel.replace(/^#/, '')}
        </span>
      )}
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        urlTransform={urlTransform}
        components={components}
      >
        {markdown}
      </ReactMarkdown>
      {images?.map((src) => (
        <img key={src} src={src} alt="" className="mt-2 max-h-64 max-w-full rounded-lg border" />
      ))}
    </div>
  )
}
