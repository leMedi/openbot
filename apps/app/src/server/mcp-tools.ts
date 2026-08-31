import { createHash } from 'node:crypto'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import {
  listRuntimeMcpAccountsForAgent,
  type ModelToolCall,
  type RuntimeMcpAccount,
} from '@openbot/db'
import type { ToolDefinition } from './ai'
import { refreshExpiredMcpOauthAccounts } from './mcp-oauth.server'

const MAX_TOOL_RESULT_LENGTH = 50_000
const MCP_DISCOVERY_TIMEOUT_MS = 10_000

type McpTool = {
  name: string
  description?: string
  inputSchema: { type: 'object'; [key: string]: unknown }
}

export type McpClientConnection = {
  listTools(cursor?: string, signal?: AbortSignal): Promise<{
    tools: McpTool[]
    nextCursor?: string
  }>
  callTool(
    name: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<unknown>
  close(): Promise<void>
}

type McpConnector = (
  account: RuntimeMcpAccount,
  signal?: AbortSignal,
) => Promise<McpClientConnection>

type RegisteredTool = {
  account: RuntimeMcpAccount
  connection: McpClientConnection
  originalName: string
}

export type McpToolRegistry = {
  definitions: ToolDefinition[]
  has(name: string): boolean
  execute(call: ModelToolCall, signal?: AbortSignal): Promise<string>
  close(): Promise<void>
}

function credentialHeader(account: RuntimeMcpAccount) {
  if (account.authType === 'oauth') {
    return `${account.credentials.tokenType} ${account.credentials.accessToken}`
  }
  const prefix = account.configuration.apiKeyPrefix.trim()
  return prefix ? `${prefix} ${account.credentials.apiKey}` : account.credentials.apiKey
}

function credentialHeaderName(account: RuntimeMcpAccount) {
  return account.authType === 'oauth'
    ? 'Authorization'
    : account.configuration.apiKeyHeader
}

function accountSecrets(account: RuntimeMcpAccount) {
  if (account.authType === 'api_key') return [account.credentials.apiKey]
  return [
    account.credentials.accessToken,
    account.credentials.refreshToken,
    account.credentials.clientSecret,
  ].filter((value): value is string => Boolean(value))
}

async function connectMcpAccount(
  account: RuntimeMcpAccount,
  signal?: AbortSignal,
): Promise<McpClientConnection> {
  const client = new Client({ name: 'openbot', version: '3' }, { capabilities: {} })
  const transport = new StreamableHTTPClientTransport(new URL(account.configuration.url), {
    requestInit: {
      headers: {
        [credentialHeaderName(account)]: credentialHeader(account),
      },
    },
  })
  await client.connect(transport, { signal })
  return {
    async listTools(cursor, requestSignal) {
      const result = await client.listTools(
        cursor ? { cursor } : undefined,
        requestSignal ? { signal: requestSignal } : undefined,
      )
      return { tools: result.tools, nextCursor: result.nextCursor }
    },
    async callTool(name, args, requestSignal) {
      return client.callTool(
        { name, arguments: args },
        undefined,
        requestSignal ? { signal: requestSignal } : undefined,
      )
    },
    close: () => client.close(),
  }
}

function redactValue(value: unknown, secrets: string[]): unknown {
  if (typeof value === 'string') {
    return secrets.reduce(
      (redacted, secret) => redacted.split(secret).join('[REDACTED]'),
      value,
    )
  }
  if (Array.isArray(value)) return value.map((item) => redactValue(item, secrets))
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        redactValue(key, secrets) as string,
        redactValue(item, secrets),
      ]),
    )
  }
  return value
}

function modelToolName(account: RuntimeMcpAccount, originalName: string) {
  const server = account.serverKey.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 16)
  const tool = originalName.replace(/[^A-Za-z0-9_-]/g, '_')
  const hash = createHash('sha256')
    .update(`${account.accountId}\0${originalName}`)
    .digest('hex')
    .slice(0, 8)
  return `mcp_${server}_${hash}_${tool}`.slice(0, 64)
}

function stringifyResult(value: unknown, secrets: string[]) {
  let content: string
  try {
    content = JSON.stringify(redactValue(value, secrets))
  } catch {
    content = JSON.stringify({ error: 'MCP tool returned an unreadable result' })
  }
  return content.length > MAX_TOOL_RESULT_LENGTH
    ? `${content.slice(0, MAX_TOOL_RESULT_LENGTH)}…`
    : content
}

export async function createMcpToolRegistry(
  accounts: RuntimeMcpAccount[],
  connector: McpConnector = connectMcpAccount,
  signal?: AbortSignal,
): Promise<McpToolRegistry> {
  const definitions: ToolDefinition[] = []
  const tools = new Map<string, RegisteredTool>()
  const connections = new Set<McpClientConnection>()
  const secrets = accounts.flatMap(accountSecrets)

  const discoveredAccounts = await Promise.all(
    accounts.map(async (account) => {
      let connection: McpClientConnection | undefined
      const timeout = AbortSignal.timeout(MCP_DISCOVERY_TIMEOUT_MS)
      const discoverySignal = signal ? AbortSignal.any([signal, timeout]) : timeout
      try {
        connection = await connector(account, discoverySignal)
        const discoveredTools: McpTool[] = []
        let cursor: string | undefined
        do {
          const page = await connection.listTools(cursor, discoverySignal)
          discoveredTools.push(...page.tools)
          cursor = page.nextCursor
        } while (cursor)
        return { account, connection, discoveredTools }
      } catch {
        await connection?.close().catch(() => {})
        return undefined
      }
    }),
  )

  for (const discovered of discoveredAccounts) {
    if (!discovered) continue
    const { account, connection, discoveredTools } = discovered
    connections.add(connection)
    for (const tool of discoveredTools) {
          const safeOriginalName = redactValue(tool.name, secrets) as string
          const name = modelToolName(account, safeOriginalName)
          if (tools.has(name)) continue
          const safeDescription = redactValue(tool.description ?? '', secrets)
          const safeSchema = redactValue(tool.inputSchema, secrets)
          const safeServerName = redactValue(account.serverName, secrets)
          const safeAccountLabel = redactValue(account.accountLabel, secrets)
          definitions.push({
            type: 'function',
            function: {
              name,
              description:
                `[${safeServerName} / ${safeAccountLabel}] ${
                  typeof safeDescription === 'string' ? safeDescription : 'MCP tool'
                }`,
              parameters:
                safeSchema && typeof safeSchema === 'object' && !Array.isArray(safeSchema)
                  ? (safeSchema as Record<string, unknown>)
                  : { type: 'object' },
            },
          })
          tools.set(name, { account, connection, originalName: tool.name })
    }
  }

  return {
    definitions,
    has: (name) => tools.has(name),
    async execute(call, requestSignal) {
      const registered = tools.get(call.function.name)
      if (!registered) return JSON.stringify({ error: `Unknown MCP tool: ${call.function.name}` })
      let args: unknown
      try {
        args = JSON.parse(call.function.arguments || '{}')
      } catch {
        return JSON.stringify({ error: 'Tool arguments must be valid JSON' })
      }
      if (!args || typeof args !== 'object' || Array.isArray(args)) {
        return JSON.stringify({ error: 'MCP tool arguments must be an object' })
      }
      try {
        const result = await registered.connection.callTool(
          registered.originalName,
          args as Record<string, unknown>,
          requestSignal,
        )
        return stringifyResult(result, secrets)
      } catch (error) {
        return stringifyResult(
          { error: error instanceof Error ? error.message : 'MCP tool execution failed' },
          secrets,
        )
      }
    },
    async close() {
      await Promise.allSettled([...connections].map((connection) => connection.close()))
    },
  }
}

export async function discoverMcpToolsForTurn(agentId: string, signal?: AbortSignal) {
  return createMcpToolRegistry(
    await refreshExpiredMcpOauthAccounts(await listRuntimeMcpAccountsForAgent(agentId)),
    connectMcpAccount,
    signal,
  )
}
