import { createFileRoute } from '@tanstack/react-router'
import {
  recoverQueuedTurns,
  type TurnStreamEvent,
  watchTurn,
} from '@openbot/agent'

// Streams one turn's visible output as server-sent events: one `message` per
// delivered SendMessage or durable tool-result row, then a terminal `done`,
// `waiting` interaction, or `error`. Reconnecting replays persisted rows and
// continues live. Execution does not depend on this connection.
export const Route = createFileRoute('/api/turns/$turnId/stream')({
  server: {
    handlers: {
      GET: ({ params, request }) => {
        recoverQueuedTurns()
        const encoder = new TextEncoder()
        const stream = new ReadableStream({
          async start(controller) {
            const send = (event: TurnStreamEvent) => {
              try {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
              } catch {
                // The client went away; the executor keeps running.
              }
            }
            await watchTurn(params.turnId, send, request.signal)
            try {
              controller.close()
            } catch {
              // Already closed by the client disconnecting.
            }
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
