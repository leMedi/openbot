import { cancelProviderLogin } from '@openbot/agent'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/api/provider-auth-flows/$flowId')({
  server: {
    handlers: {
      DELETE: ({ params }) => {
        cancelProviderLogin(params.flowId)
        return Response.json({ ok: true })
      },
    },
  },
})
