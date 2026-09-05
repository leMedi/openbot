import { respondToProviderLogin } from '@openbot/agent'
import { createFileRoute } from '@tanstack/react-router'
import * as z from 'zod'

const inputSchema = z.object({
  promptId: z.string().min(1),
  value: z.string(),
})

export const Route = createFileRoute('/api/provider-auth-flows/$flowId/respond')({
  server: {
    handlers: {
      POST: async ({ params, request }) => {
        try {
          const input = inputSchema.parse(await request.json())
          respondToProviderLogin(params.flowId, input.promptId, input.value)
          return Response.json({ ok: true })
        } catch (cause) {
          return Response.json(
            { error: cause instanceof Error ? cause.message : 'Login response was rejected' },
            { status: 400 },
          )
        }
      },
    },
  },
})
