import { watchProviderLogin, type ProviderAuthFlowEvent } from '@openbot/agent'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/api/provider-auth-flows/$flowId/stream')({
  server: {
    handlers: {
      GET: ({ params, request }) => {
        const encoder = new TextEncoder()
        const stream = new ReadableStream({
          async start(controller) {
            const send = (event: ProviderAuthFlowEvent) => {
              try {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
              } catch {
                // The login keeps running so a reconnect can replay its events.
              }
            }
            try {
              await watchProviderLogin(params.flowId, send, request.signal)
            } catch (cause) {
              send({
                type: 'error',
                message: cause instanceof Error ? cause.message : 'Provider login stream failed',
              })
            }
            try {
              controller.close()
            } catch {
              // Already closed by the browser.
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
