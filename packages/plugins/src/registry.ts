import { createHash } from 'node:crypto'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import {
  listRuntimeMcpAccountsForAgent,
  type ModelToolCall,
  type RuntimeMcpAccount,
  type ToolDefinition,
} from '@openbot/db'
import { refreshExpiredMcpOauthAccount } from './oauth'

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

const gatewayDefinitions: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'McpSearch',
      description:
        'Search tools available through the MCP accounts connected to this agent. Returns compact tool references and explicit status for every account.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Case-insensitive text to match against tool names and descriptions.',
          },
          refresh: {
            type: 'boolean',
            description: 'Ignore cached metadata and fetch current tool catalogs.',
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'McpDescribe',
      description: 'Return the current input schema for one MCP tool reference.',
      parameters: {
        type: 'object',
        properties: {
          tool: {
            type: 'string',
            description: 'Exact tool reference returned by McpSearch.',
          },
          refresh: {
            type: 'boolean',
            description: 'Refresh the owning account catalog before describing the tool.',
          },
        },
        required: ['tool'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'McpCall',
      description: 'Invoke one MCP tool using an exact tool reference returned by McpSearch.',
      parameters: {
        type: 'object',
        properties: {
          tool: {
            type: 'string',
            description: 'Exact tool reference returned by McpSearch.',
          },
          arguments: {
            type: 'object',
            description: 'Arguments matching the schema returned by McpDescribe.',
            additionalProperties: true,
          },
        },
        required: ['tool', 'arguments'],
        additionalProperties: false,
      },
    },
  },
]

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

function toolReference(account: RuntimeMcpAccount, originalName: string) {
  const server = account.serverKey.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 24)
  const tool = originalName.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 48)
  const accountHash = createHash('sha256').update(account.accountId).digest('hex').slice(0, 10)
  const toolHash = createHash('sha256')
    .update(`${account.accountId}\0${originalName}`)
    .digest('hex')
    .slice(0, 10)
  return `${server}:${accountHash}:${toolHash}:${tool}`
}

function referenceAccountHash(reference: string) {
  return reference.split(':', 3)[1]
}

function runtimeAccountHash(runtime: AccountRuntime) {
  return createHash('sha256').update(runtime.account.accountId).digest('hex').slice(0, 10)
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
  return content.length > MAX_TOOL_RESULT_LENGTH
    ? `${content.slice(0, MAX_TOOL_RESULT_LENGTH)}...`
    : content
}

function accountSummary(runtime: AccountRuntime) {
  return {
    server: runtime.account.serverName,
    account: runtime.account.accountLabel,
    status: runtime.status,
    ...(runtime.tools ? { toolCount: runtime.tools.length } : {}),
    ...(runtime.error ? { error: runtime.error } : {}),
  }
}

export function createMcpToolRegistry(
  accounts: RuntimeMcpAccount[],
  connector: McpConnector = connectMcpAccount,
  prepareAccount: McpAccountPreparer = async (account) => account,
): McpToolRegistry {
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

  async function findTool(reference: string, signal?: AbortSignal, refresh = false) {
    const accountHash = referenceAccountHash(reference)
    const candidates = accountHash
      ? runtimes.filter((runtime) => runtimeAccountHash(runtime) === accountHash)
      : []
    for (const runtime of candidates) {
      if (refresh || !runtime.tools) {
        try {
          await loadMetadata(runtime, signal, refresh)
        } catch {
          continue
        }
      }
      const tool = runtime.tools?.find((candidate) => candidate.reference === reference)
      if (tool) return { runtime, tool }
    }
    return undefined
  }

  return {
    definitions: gatewayDefinitions,
    async execute(call, signal) {
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

      if (call.function.name === 'McpSearch') {
        const query = typeof input.query === 'string' ? input.query.trim().toLowerCase() : ''
        const refresh = input.refresh === true
        await Promise.allSettled(
          runtimes.map((runtime) => loadMetadata(runtime, signal, refresh)),
        )
        const tools = runtimes.flatMap((runtime) =>
          (runtime.tools ?? [])
            .filter((tool) =>
              !query || `${tool.name}\n${tool.description ?? ''}`.toLowerCase().includes(query),
            )
            .map((tool) => ({
              tool: tool.reference,
              name: tool.name,
              description: tool.description,
              server: runtime.account.serverName,
              account: runtime.account.accountLabel,
            })),
        )
        return stringifyResult(
          { accounts: runtimes.map(accountSummary), tools },
          secrets,
        )
      }

      if (call.function.name === 'McpDescribe') {
        if (typeof input.tool !== 'string' || !input.tool) {
          return JSON.stringify({ error: 'McpDescribe requires a tool reference' })
        }
        const found = await findTool(input.tool, signal, input.refresh === true)
        if (!found) {
          return stringifyResult(
            {
              error: `Unknown MCP tool: ${input.tool}`,
              accounts: runtimes.map(accountSummary),
            },
            secrets,
          )
        }
        return stringifyResult(
          {
            tool: found.tool.reference,
            name: found.tool.name,
            description: found.tool.description,
            inputSchema: found.tool.inputSchema,
            server: found.runtime.account.serverName,
            account: found.runtime.account.accountLabel,
            status: found.runtime.status,
          },
          secrets,
        )
      }

      if (call.function.name === 'McpCall') {
        if (typeof input.tool !== 'string' || !input.tool) {
          return JSON.stringify({ error: 'McpCall requires a tool reference' })
        }
        if (!input.arguments || typeof input.arguments !== 'object' || Array.isArray(input.arguments)) {
          return JSON.stringify({ error: 'McpCall arguments must be an object' })
        }
        const found = await findTool(input.tool, signal)
        if (!found) {
          return stringifyResult(
            {
              error: `Unknown MCP tool: ${input.tool}`,
              accounts: runtimes.map(accountSummary),
            },
            secrets,
          )
        }
        try {
          const connection = await ensureConnection(found.runtime, signal)
          const result = await connection.callTool(
            found.tool.originalName,
            input.arguments as Record<string, unknown>,
            requestSignal(signal),
          )
          const toolFailed =
            result !== null &&
            typeof result === 'object' &&
            'isError' in result &&
            result.isError === true
          return stringifyResult(
            {
              server: found.runtime.account.serverName,
              account: found.runtime.account.accountLabel,
              status: found.runtime.status,
              toolStatus: toolFailed ? 'failed' : 'succeeded',
              ...(toolFailed ? { error: 'MCP tool reported a failure' } : {}),
              result,
            },
            secrets,
          )
        } catch (error) {
          found.runtime.status = 'failed'
          found.runtime.error = errorMessage(error)
          await discardConnection(found.runtime)
          return stringifyResult(
            {
              server: found.runtime.account.serverName,
              account: found.runtime.account.accountLabel,
              status: found.runtime.status,
              error: found.runtime.error,
            },
            secrets,
          )
        }
      }

      return JSON.stringify({ error: `Unknown MCP gateway tool: ${call.function.name}` })
    },
    async close() {
      await Promise.allSettled(
        runtimes.flatMap((runtime) =>
          runtime.connection ? [runtime.connection.close()] : [],
        ),
      )
    },
  }
}

export async function createMcpGatewayForTurn(agentId: string) {
  return createMcpToolRegistry(
    await listRuntimeMcpAccountsForAgent(agentId),
    connectMcpAccount,
    refreshExpiredMcpOauthAccount,
  )
}
