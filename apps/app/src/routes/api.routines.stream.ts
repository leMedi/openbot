import { createFileRoute } from '@tanstack/react-router'
import { type RoutineStreamEvent, watchRoutineEvents } from '@openbot/agent'

export const Route = createFileRoute('/api/routines/stream')({
  server: {
    handlers: {
      GET: ({ request }) => {
        const encoder = new TextEncoder()
        const stream = new ReadableStream({
          async start(controller) {
            const send = (event: RoutineStreamEvent) => {
              try {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
              } catch {
                // Client disconnected between the abort and this publish.
              }
            }
            controller.enqueue(encoder.encode(': connected\n\n'))
            await watchRoutineEvents(send, request.signal)
            try {
              controller.close()
            } catch {
              // Already closed by the client.
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
