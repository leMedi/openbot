// Client consumer for the turn SSE endpoint (routes/api.turns.$turnId.stream).

// Type-only import: erased at build time, so the server module never reaches
// the client bundle. The event shape has exactly one definition.
import type { TurnStreamEvent } from '@openbot/agent'

export type { TurnStreamEvent }

/**
 * Consumes one turn's event stream until the server closes it. Resolves after
 * the terminal `done`/`error` event; rejects only on transport failures.
 */
export async function streamTurn(
  turnId: string,
  onEvent: (event: TurnStreamEvent) => void,
): Promise<void> {
  const response = await fetch(`/api/turns/${encodeURIComponent(turnId)}/stream`)
  if (!response.ok || !response.body) {
    throw new Error(`Turn stream failed (${response.status})`)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  const consumeLine = (line: string) => {
    if (!line.startsWith('data:')) return
    try {
      onEvent(JSON.parse(line.slice(5).trim()) as TurnStreamEvent)
    } catch {
      // Skip malformed frames rather than dropping the whole stream.
    }
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let newline = buffer.indexOf('\n')
    while (newline !== -1) {
      consumeLine(buffer.slice(0, newline).trim())
      buffer = buffer.slice(newline + 1)
      newline = buffer.indexOf('\n')
    }
  }
}
