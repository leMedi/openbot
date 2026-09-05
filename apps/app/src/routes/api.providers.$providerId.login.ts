import { beginProviderLogin } from '@openbot/agent'
import { createFileRoute } from '@tanstack/react-router'
import * as z from 'zod'

const inputSchema = z.object({ authType: z.enum(['api_key', 'oauth']) })

export const Route = createFileRoute('/api/providers/$providerId/login')({
  server: {
    handlers: {
      POST: async ({ params, request }) => {
        try {
          const input = inputSchema.parse(await request.json())
          return Response.json(await beginProviderLogin(params.providerId, input.authType))
        } catch (cause) {
          return Response.json(
            { error: cause instanceof Error ? cause.message : 'Provider login could not start' },
            { status: 400 },
          )
        }
      },
    },
  },
})
