import { createFileRoute } from '@tanstack/react-router'
import {
  beginMcpOauthAuthorization,
  findMcpCatalogEntry,
  installCatalogServer,
  mcpOauthPublicUrl,
} from '@openbot/plugins'
import { getTurn, waitingStateSchema } from '@openbot/db'

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
        const pluginKey = url.searchParams.get('pluginKey') ?? ''
        const turnId = url.searchParams.get('turnId') ?? ''
        const toolCallId = url.searchParams.get('toolCallId') ?? ''
        const label = url.searchParams.get('label') ?? ''

        try {
          let resolvedServerId = serverId
          let continuation
          if (pluginKey || turnId || toolCallId) {
            const turn = await getTurn(turnId)
            const waiting = turn?.waitingStateJson
              ? waitingStateSchema.parse(turn.waitingStateJson)
              : undefined
            const resumeData = waiting?.resumeData
            const entry = findMcpCatalogEntry(pluginKey)
            if (
              !turn ||
              turn.status !== 'waiting' ||
              !turn.targetAgentId ||
              !waiting ||
              waiting.interactionKind !== 'approval' ||
              waiting.originatingToolCall.name !== 'InstallPlugin' ||
              waiting.originatingToolCall.id !== toolCallId ||
              waiting.plugin?.key !== pluginKey ||
              waiting.response !== null ||
              !resumeData ||
              typeof resumeData !== 'object' ||
              Array.isArray(resumeData) ||
              !Array.isArray(resumeData.accountIds) ||
              resumeData.accountIds.length !== 0 ||
              !entry?.auth.some((auth) => auth.type === 'oauth')
            ) throw new Error('Turn is not waiting for this plugin connection')
            const server = await installCatalogServer({ key: pluginKey })
            resolvedServerId = server.id
            continuation = {
              turnId,
              toolCallId,
              agentId: turn.targetAgentId,
              pluginKey,
            }
          }
          const redirectUrl = new URL('/api/mcp/oauth/callback', mcpOauthPublicUrl(request.url))
          const authorization = await beginMcpOauthAuthorization({
            serverId: resolvedServerId,
            label: label || 'account 1',
            redirectUrl: redirectUrl.toString(),
            continuation,
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
