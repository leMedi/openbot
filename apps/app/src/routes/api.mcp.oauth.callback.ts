import { createFileRoute } from '@tanstack/react-router'
import {
  finishMcpOauthAuthorization,
  mcpOauthPublicUrl,
  rejectMcpOauthAuthorization,
} from '@/server/mcp-oauth.server'

function resultRedirect(requestUrl: string, result: 'success' | 'error') {
  const url = mcpOauthPublicUrl(requestUrl)
  url.searchParams.set('mcpOAuth', result)
  return Response.redirect(url)
}

export const Route = createFileRoute('/api/mcp/oauth/callback')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url)
        const state = url.searchParams.get('state') ?? ''
        const code = url.searchParams.get('code') ?? ''

        try {
          if (url.searchParams.has('error')) {
            rejectMcpOauthAuthorization(state)
            return resultRedirect(request.url, 'error')
          }
          await finishMcpOauthAuthorization({
            state,
            code,
            issuer: url.searchParams.get('iss') ?? undefined,
          })
          return resultRedirect(request.url, 'success')
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
