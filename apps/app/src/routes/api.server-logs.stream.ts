import { createFileRoute } from '@tanstack/react-router'
import {
  installServerLogCapture,
  listServerLogs,
  subscribeServerLogs,
  type ServerLogEntry,
} from '@/server/logs'

// Streams the server's recent console output as server-sent events: one
// `data` frame per log entry, buffered history first, then live entries.
// `Last-Event-ID` (sent automatically by EventSource on reconnect) or an
// `after` query parameter skips entries the client already has.
export const Route = createFileRoute('/api/server-logs/stream')({
  server: {
    handlers: {
      GET: ({ request }) => {
        installServerLogCapture()
        const url = new URL(request.url)
        const afterId = Number(request.headers.get('last-event-id') ?? url.searchParams.get('after') ?? 0) || 0
        const encoder = new TextEncoder()
        let unsubscribe: (() => void) | null = null
        const stream = new ReadableStream({
          start(controller) {
            const send = (entry: ServerLogEntry) => {
              try {
                controller.enqueue(encoder.encode(`id: ${entry.id}\ndata: ${JSON.stringify(entry)}\n\n`))
              } catch {
                unsubscribe?.()
              }
            }
            for (const entry of listServerLogs(afterId)) send(entry)
            unsubscribe = subscribeServerLogs(send)
            request.signal.addEventListener('abort', () => {
              unsubscribe?.()
              try { controller.close() } catch { /* Already closed. */ }
            }, { once: true })
          },
          cancel() {
            unsubscribe?.()
          },
        })
        return new Response(stream, {
          headers: {
            'content-type': 'text/event-stream',
            'cache-control': 'no-cache',
            connection: 'keep-alive',
          },
        })
      },
    },
  },
})
