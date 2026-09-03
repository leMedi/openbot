import { createFileRoute } from '@tanstack/react-router'
import {
  finishMcpOauthAuthorization,
  mcpOauthPublicUrl,
  rejectMcpOauthAuthorization,
} from '@openbot/plugins'
import { ensureDrainForTurn } from '@openbot/agent'
import { grantAgentMcpAccount, respondToWaitingTurn } from '@openbot/db'
import { randomUUID } from 'node:crypto'

function resultRedirect(requestUrl: string, result: 'success' | 'error' | 'resumed') {
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
          const completed = await finishMcpOauthAuthorization({
            state,
            code,
            issuer: url.searchParams.get('iss') ?? undefined,
          })
          if (completed.continuation) {
            await grantAgentMcpAccount(
              completed.continuation.agentId,
              completed.account.id,
            )
            const resumed = await respondToWaitingTurn({
              turnId: completed.continuation.turnId,
              toolCallId: completed.continuation.toolCallId,
              text: `Connected ${completed.continuation.pluginKey}`,
              optionId: 'approve',
              requestId: `req_${randomUUID()}`,
              idempotencyKey: `idem_${randomUUID()}`,
            })
            ensureDrainForTurn(resumed.turn)
            return resultRedirect(request.url, 'resumed')
          }
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
