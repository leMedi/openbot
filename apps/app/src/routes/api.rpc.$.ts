import { router } from '@openbot/api'
import { onError, ORPCError } from '@orpc/server'
import { RPCHandler } from '@orpc/server/fetch'
import { createFileRoute } from '@tanstack/react-router'

// Every typed procedure in @openbot/api is served here over oRPC's RPC
// protocol, including the event-iterator streams (turn output, routine
// events, server logs, provider login), which travel as server-sent events.
const handler = new RPCHandler(router, {
  interceptors: [
    onError((error) => {
      // Expected client errors (validation, not found) already reach the
      // caller with their message; only server failures belong in the log.
      if (error instanceof ORPCError && error.status < 500) return
      console.error('[rpc]', error)
    }),
  ],
})

export const Route = createFileRoute('/api/rpc/$')({
  server: {
    handlers: {
      ANY: async ({ request }) => {
        const { response } = await handler.handle(request, {
          prefix: '/api/rpc',
          context: { headers: request.headers },
        })
        return response ?? new Response('Not found', { status: 404 })
      },
    },
  },
})
