import { useEffect, useId, useRef, useState } from 'react'

/** Renders a mermaid fenced block via dynamically loaded Mermaid. */
export function MermaidViewer({ code }: { code: string }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '')
  const ref = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function render() {
      try {
        const mermaid = (await import('mermaid')).default
        mermaid.initialize({
          startOnLoad: false,
          theme: 'dark',
          themeVariables: { fontFamily: 'inherit' },
        })
        const { svg } = await mermaid.render(`mmd-${id}`, code)
        if (!cancelled && ref.current) ref.current.innerHTML = svg
      } catch (caught) {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : 'Could not render diagram')
        }
      }
    }
    render()
    return () => {
      cancelled = true
    }
  }, [code, id])

  if (error) {
    return (
      <pre className="my-2 overflow-x-auto rounded-lg border bg-background/60 px-3 py-2 font-mono text-[11px] text-destructive">
        mermaid: {error}
      </pre>
    )
  }
  return (
    <div
      ref={ref}
      className="my-2 flex justify-center overflow-x-auto rounded-lg border bg-background/40 p-3 [&_svg]:max-w-full"
    />
  )
}
