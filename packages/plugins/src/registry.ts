import { createHash } from 'node:crypto'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import {
  listRuntimeMcpAccountsForAgent,
  type ModelToolCall,
  type RuntimeMcpAccount,
  type ToolDefinition,
} from '@openbot/db'
import { refreshExpiredMcpOauthAccountOnce } from './oauth'

const MAX_TOOL_RESULT_LENGTH = 50_000
const MCP_REQUEST_TIMEOUT_MS = 30_000
const MCP_METADATA_CACHE_TTL_MS = 5 * 60_000

type McpTool = {
  name: string
  description?: string
  inputSchema: { type: 'object'; [key: string]: unknown }
}

type CachedTool = McpTool & {
  reference: string
  originalName: string
}

type MetadataCacheEntry = {
  fingerprint: string
  cachedAt: number
  tools: CachedTool[]
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

export type McpConnector = (
  account: RuntimeMcpAccount,
  signal?: AbortSignal,
) => Promise<McpClientConnection>

export type McpAccountPreparer = (
  account: RuntimeMcpAccount,
) => Promise<RuntimeMcpAccount>

export type McpAccountAuthorizer = (accountId: string) => Promise<boolean>

type AccountStatus = 'not_connected' | 'cached' | 'connected' | 'failed'

type AccountRuntime = {
  account: RuntimeMcpAccount
  fingerprint: string
  status: AccountStatus
  error?: string
  connection?: McpClientConnection
  connectionPromise?: Promise<McpClientConnection>
  metadataPromise?: Promise<CachedTool[]>
  tools?: CachedTool[]
}

export type McpToolRegistry = {
  definitions: ToolDefinition[]
  execute(call: ModelToolCall, signal?: AbortSignal): Promise<string>
  close(): Promise<void>
}

const metadataCache = new Map<string, MetadataCacheEntry>()

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
  try {
    await client.connect(transport, { signal })
  } catch (error) {
    await client.close().catch(() => {})
    throw error
  }
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

function toolReference(account: RuntimeMcpAccount, originalName: string) {
  const server = account.serverKey.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 24)
  const tool = originalName.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 48)
  const hash = createHash('sha256')
    .update(`${account.accountId}\0${originalName}`)
    .digest('hex')
    .slice(0, 8)
  return `mcp_${server}_${hash}_${tool}`.slice(0, 64)
}

function accountFingerprint(account: RuntimeMcpAccount) {
  const authIdentity = account.authType === 'api_key'
    ? account.credentials.apiKey
    : JSON.stringify({
        clientId: account.credentials.clientId,
        issuer: account.credentials.issuer,
        resource: account.credentials.resourceServerUrl,
        scope: account.credentials.scope,
      })
  return JSON.stringify({
    serverId: account.serverId,
    serverKey: account.serverKey,
    transport: account.transport,
    configuration: account.configuration,
    authType: account.authType,
    authIdentityHash: createHash('sha256').update(authIdentity).digest('hex'),
  })
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'MCP request failed'
}

function requestSignal(signal?: AbortSignal) {
  const timeout = AbortSignal.timeout(MCP_REQUEST_TIMEOUT_MS)
  return signal ? AbortSignal.any([signal, timeout]) : timeout
}

function stringifyResult(value: unknown, secrets: string[]) {
  let content: string
  try {
    content = JSON.stringify(redactValue(value, secrets))
  } catch {
    content = JSON.stringify({ error: 'MCP tool returned an unreadable result' })
  }
  if (content.length <= MAX_TOOL_RESULT_LENGTH) return content
  return JSON.stringify({
    truncated: true,
    error: `MCP gateway result exceeded ${MAX_TOOL_RESULT_LENGTH} characters`,
    preview: content.slice(0, 20_000),
  })
}

export async function createMcpToolRegistry(
  accounts: RuntimeMcpAccount[],
  connector: McpConnector = connectMcpAccount,
  prepareAccount: McpAccountPreparer = async (account) => account,
  authorizeAccount: McpAccountAuthorizer = async () => true,
): Promise<McpToolRegistry> {
  let closed = false
  const now = Date.now()
  for (const [accountId, cached] of metadataCache) {
    if (now - cached.cachedAt >= MCP_METADATA_CACHE_TTL_MS) metadataCache.delete(accountId)
  }
  const secrets = accounts.flatMap(accountSecrets)
  const runtimes = accounts.map((account): AccountRuntime => {
    const fingerprint = accountFingerprint(account)
    const cached = metadataCache.get(account.accountId)
    const cacheIsValid =
      cached?.fingerprint === fingerprint &&
      now - cached.cachedAt < MCP_METADATA_CACHE_TTL_MS
    return {
      account,
      fingerprint,
      status: cacheIsValid ? 'cached' : 'not_connected',
      ...(cacheIsValid ? { tools: cached.tools } : {}),
    }
  })

  async function ensureConnection(runtime: AccountRuntime, signal?: AbortSignal) {
    if (closed) throw new Error('MCP gateway is closed')
    if (runtime.connection) {
      runtime.status = 'connected'
      delete runtime.error
      return runtime.connection
    }
    if (runtime.connectionPromise) return runtime.connectionPromise
    const attempt = (async () => {
      runtime.account = await prepareAccount(runtime.account)
      runtime.fingerprint = accountFingerprint(runtime.account)
      secrets.push(...accountSecrets(runtime.account))
      const connection = await connector(runtime.account, requestSignal(signal))
      if (closed) {
        await connection.close().catch(() => {})
        throw new Error('MCP gateway is closed')
      }
      runtime.connection = connection
      runtime.status = 'connected'
      delete runtime.error
      return connection
    })()
    runtime.connectionPromise = attempt
    try {
      return await attempt
    } catch (error) {
      runtime.status = 'failed'
      runtime.error = errorMessage(error)
      throw error
    } finally {
      if (runtime.connectionPromise === attempt) delete runtime.connectionPromise
    }
  }

  async function discardConnection(
    runtime: AccountRuntime,
    connection = runtime.connection,
  ) {
    if (runtime.connection === connection) delete runtime.connection
    await connection?.close().catch(() => {})
  }

  async function loadMetadata(
    runtime: AccountRuntime,
    signal?: AbortSignal,
    refresh = false,
  ) {
    if (!refresh && runtime.tools) return runtime.tools
    if (runtime.metadataPromise) return runtime.metadataPromise
    if (refresh) {
      delete runtime.tools
      metadataCache.delete(runtime.account.accountId)
    }
    const operationSignal = requestSignal(signal)
    const attempt = (async () => {
      const connection = await ensureConnection(runtime, operationSignal)
      const tools: CachedTool[] = []
      const seenCursors = new Set<string>()
      let cursor: string | undefined
      do {
        if (cursor && seenCursors.has(cursor)) {
          throw new Error('MCP tool pagination repeated a cursor')
        }
        if (cursor) seenCursors.add(cursor)
        const page = await connection.listTools(cursor, operationSignal)
        for (const tool of page.tools) {
          const safeName = redactValue(tool.name, secrets)
          const safeDescription = redactValue(tool.description ?? '', secrets)
          const safeSchema = redactValue(tool.inputSchema, secrets)
          tools.push({
            name: typeof safeName === 'string' ? safeName : 'unknown',
            originalName: tool.name,
            description: typeof safeDescription === 'string' ? safeDescription : '',
            inputSchema:
              safeSchema && typeof safeSchema === 'object' && !Array.isArray(safeSchema)
                ? (safeSchema as McpTool['inputSchema'])
                : { type: 'object' },
            reference: toolReference(runtime.account, tool.name),
          })
        }
        cursor = page.nextCursor
      } while (cursor)
      runtime.tools = tools
      runtime.status = 'connected'
      delete runtime.error
      metadataCache.set(runtime.account.accountId, {
        fingerprint: runtime.fingerprint,
        cachedAt: Date.now(),
        tools,
      })
      return tools
    })()
    runtime.metadataPromise = attempt
    try {
      return await attempt
    } catch (error) {
      runtime.status = 'failed'
      runtime.error = errorMessage(error)
      await discardConnection(runtime)
      throw error
    } finally {
      if (runtime.metadataPromise === attempt) delete runtime.metadataPromise
    }
  }

  await Promise.allSettled(runtimes.map((runtime) => loadMetadata(runtime)))
  await Promise.allSettled(runtimes.map((runtime) => discardConnection(runtime)))

  const registered = new Map<string, { runtime: AccountRuntime; tool: CachedTool }>()
  const definitions: ToolDefinition[] = []
  for (const runtime of runtimes) {
    for (const tool of runtime.tools ?? []) {
      if (registered.has(tool.reference)) continue
      registered.set(tool.reference, { runtime, tool })
      definitions.push({
        type: 'function',
        function: {
          name: tool.reference,
          description: `[${runtime.account.serverName} / ${runtime.account.accountLabel}] ${tool.description || 'MCP tool'}`,
          parameters: tool.inputSchema,
        },
      })
    }
  }

  return {
    definitions,
    async execute(call, signal) {
      const found = registered.get(call.function.name)
      if (!found) return JSON.stringify({ error: `Unknown MCP tool: ${call.function.name}` })
      let args: unknown
      try {
        args = JSON.parse(call.function.arguments || '{}')
      } catch {
        return JSON.stringify({ error: 'Tool arguments must be valid JSON' })
      }
      if (!args || typeof args !== 'object' || Array.isArray(args)) {
        return JSON.stringify({ error: 'Tool arguments must be an object' })
      }
      const input = args as Record<string, unknown>
      try {
        if (!(await authorizeAccount(found.runtime.account.accountId))) {
          return JSON.stringify({ error: 'This MCP account is no longer granted to the agent' })
        }
        const connection = await ensureConnection(found.runtime, signal)
        const result = await connection.callTool(
          found.tool.originalName,
          input,
          requestSignal(signal),
        )
        return stringifyResult(result, secrets)
      } catch (error) {
        found.runtime.status = 'failed'
        found.runtime.error = errorMessage(error)
        await discardConnection(found.runtime)
        return stringifyResult({ error: found.runtime.error }, secrets)
      }
    },
    async close() {
      closed = true
      await Promise.allSettled(
        runtimes.map(async (runtime) => {
          await runtime.connectionPromise?.catch(() => {})
          await discardConnection(runtime)
        }),
      )
    },
  }
}

export async function createMcpToolsForTurn(agentId: string) {
  return createMcpToolRegistry(
    await listRuntimeMcpAccountsForAgent(agentId),
    connectMcpAccount,
    refreshExpiredMcpOauthAccountOnce,
    async (accountId) =>
      (await listRuntimeMcpAccountsForAgent(agentId)).some(
        (account) => account.accountId === accountId,
      ),
  )
}
