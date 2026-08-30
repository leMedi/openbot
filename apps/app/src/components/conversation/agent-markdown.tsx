import { lazy, Suspense } from 'react'
import type { AgentMessageContentProps } from './markdown'

// KaTeX + markdown pipeline loads on demand; Mermaid loads inside the viewer.
const Content = lazy(() => import('./markdown'))

export function AgentMarkdown(props: AgentMessageContentProps) {
  return (
    <Suspense
      fallback={
        <div className="text-sm whitespace-pre-wrap text-muted-foreground">{props.markdown}</div>
      }
    >
      <Content {...props} />
    </Suspense>
  )
}
