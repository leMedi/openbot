import { getAgent } from '@openbot/db'
import { createDesktopDriver, isDesktopEnabled } from '@openbot/agent'
import { createFileRoute } from '@tanstack/react-router'

/** Returns a current, server-captured image for the agent sidebar preview. */
export const Route = createFileRoute('/api/agents/$agentId/desktop/screenshot')({
  server: {
    handlers: {
      GET: async ({ params }) => {
        if (!isDesktopEnabled()) {
          return Response.json({ error: 'Desktop mode is disabled' }, { status: 409 })
        }
        const agent = await getAgent(params.agentId)
        if (!agent) return Response.json({ error: 'Agent not found' }, { status: 404 })
        if (agent.xDisplayNumber === null) {
          return Response.json({ error: 'Agent has no desktop' }, { status: 409 })
        }

        try {
          const screenshot = await createDesktopDriver(agent.xDisplayNumber).captureScreenshot()
          const bytes = Buffer.from(screenshot.dataBase64, 'base64')
          return new Response(new Uint8Array(bytes), {
            headers: {
              'content-type': screenshot.mediaType,
              'cache-control': 'no-store',
              'content-length': String(bytes.byteLength),
            },
          })
        } catch (error) {
          return Response.json(
            { error: error instanceof Error ? error.message : 'Desktop unavailable' },
            { status: 503 },
          )
        }
      },
    },
  },
})
