import { createFileRoute } from '@tanstack/react-router'
import {
  finishMcpOauthAuthorization,
  McpOauthError,
  mcpOauthPublicUrl,
  rejectMcpOauthAuthorization,
} from '@openbot/plugins'
import { ensureDrainForTurn } from '@openbot/agent'
import { grantAgentMcpAccount, respondToWaitingTurn } from '@openbot/db'
import { randomUUID } from 'node:crypto'
import type { McpOauthFeedbackCode } from '@/lib/mcp-oauth-error'

function resultRedirect(
  requestUrl: string,
  result: 'success' | 'error' | 'resumed',
  errorCode?: McpOauthFeedbackCode,
) {
  const url = mcpOauthPublicUrl(requestUrl)
  url.searchParams.set('mcpOAuth', result)
  if (errorCode) url.searchParams.set('mcpOAuthError', errorCode)
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
            return resultRedirect(request.url, 'error', 'authorization-denied')
          }
          let completed
          try {
            completed = await finishMcpOauthAuthorization({
              state,
              code,
              issuer: url.searchParams.get('iss') ?? undefined,
            })
          } catch (cause) {
            const errorCode: McpOauthFeedbackCode =
              cause instanceof McpOauthError
                ? cause.code
                : 'authorization-completion-failed'
            console.error(`Could not complete MCP OAuth authorization (${errorCode})`)
            return resultRedirect(request.url, 'error', errorCode)
          }
          if (completed.continuation) {
            try {
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
            } catch {
              console.error('Could not resume turn after MCP OAuth authorization (continuation-failed)')
              return resultRedirect(request.url, 'error', 'continuation-failed')
            }
          }
          return resultRedirect(request.url, 'success')
        } catch (cause) {
          console.error('Could not process MCP OAuth callback (authorization-invalid)')
          try {
            return resultRedirect(request.url, 'error', 'authorization-invalid')
          } catch {
            return Response.json({ error: 'MCP OAuth public URL is not configured' }, { status: 400 })
          }
        }
      },
    },
  },
})
