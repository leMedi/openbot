import { createFileRoute } from '@tanstack/react-router'
import {
  beginMcpOauthAuthorization,
  mcpOauthPublicUrl,
} from '@openbot/plugins'

function resultRedirect(requestUrl: string, result: 'error') {
  const url = mcpOauthPublicUrl(requestUrl)
  url.searchParams.set('mcpOAuth', result)
  return Response.redirect(url)
}

export const Route = createFileRoute('/api/mcp/oauth/start')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url)
        const serverId = url.searchParams.get('serverId') ?? ''
        const label = url.searchParams.get('label') ?? ''

        try {
          const redirectUrl = new URL('/api/mcp/oauth/callback', mcpOauthPublicUrl(request.url))
          const authorization = await beginMcpOauthAuthorization({
            serverId,
            label,
            redirectUrl: redirectUrl.toString(),
          })
          return Response.redirect(authorization.authorizationUrl)
        } catch {
          try {
            return resultRedirect(request.url, 'error')
          } catch {
            return Response.json({ error: 'MCP OAuth public URL is not configured' }, { status: 400 })
          }
        }
      },
    },
  },
})
