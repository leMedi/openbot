import { randomBytes } from 'node:crypto'
import {
  discoverAuthorizationServerMetadata,
  discoverOAuthProtectedResourceMetadata,
  exchangeAuthorization,
  refreshAuthorization,
  registerClient,
  startAuthorization,
} from '@modelcontextprotocol/sdk/client/auth.js'
import { checkResourceAllowed, resourceUrlFromServerUrl } from '@modelcontextprotocol/sdk/shared/auth-utils.js'
import type {
  AuthorizationServerMetadata,
  OAuthClientInformationMixed,
  OAuthProtectedResourceMetadata,
} from '@modelcontextprotocol/sdk/shared/auth.js'
import type { FetchLike } from '@modelcontextprotocol/sdk/shared/transport.js'
import {
  createMcpOauthAccount,
  getMcpServer,
  updateMcpOauthCredentials,
  type OauthCredentials,
  type RuntimeMcpAccount,
} from '@openbot/db'

const OAUTH_FLOW_TTL_MS = 10 * 60_000
const OAUTH_REFRESH_SKEW_MS = 30_000
const MAX_PENDING_OAUTH_FLOWS = 100
const OAUTH_REQUEST_TIMEOUT_MS = 10_000

export type McpOauthTokens = {
  access_token: string
  refresh_token?: string
  token_type: string
  expires_in?: number
  scope?: string
}

type McpOauthClientInformation = {
  client_id: string
  client_secret?: string
  token_endpoint_auth_method?: string
}

export type PrepareMcpOauthInput = {
  serverUrl: string
  redirectUrl: string
  state: string
}

export type PreparedMcpOauthFlow = {
  state: string
  authorizationUrl: URL
  codeVerifier: string
  authorizationServerUrl: string
  clientInformation: McpOauthClientInformation
  authorizationServerMetadata?: AuthorizationServerMetadata
  resourceMetadata?: OAuthProtectedResourceMetadata
  resource?: URL
  redirectUrl?: string
  tokenEndpoint?: string
  issuer?: string
  issuerRequired?: boolean
}

type PendingMcpOauthFlow = PreparedMcpOauthFlow & {
  serverId: string
  serverUrl: string
  label: string
  redirectUrl: string
  expiresAt: number
  timeout: NodeJS.Timeout
}

type McpOauthOperations = {
  prepare(input: PrepareMcpOauthInput): Promise<PreparedMcpOauthFlow>
  exchange(flow: PreparedMcpOauthFlow, code: string): Promise<McpOauthTokens>
}

type McpOauthCoordinatorOptions = McpOauthOperations & {
  now?: () => number
  state?: () => string
}

function oauthResource(
  serverUrl: string,
  resourceMetadata?: OAuthProtectedResourceMetadata,
) {
  if (!resourceMetadata) return undefined
  const requested = resourceUrlFromServerUrl(serverUrl)
  if (
    !checkResourceAllowed({
      requestedResource: requested,
      configuredResource: resourceMetadata.resource,
    })
  ) {
    throw new Error('OAuth protected resource does not match the MCP server')
  }
  return new URL(resourceMetadata.resource)
}

function isLoopback(hostname: string) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
}

function secureOauthUrl(value: string | URL) {
  const url = new URL(value)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback(url.hostname))) {
    throw new Error('MCP OAuth requires HTTPS except on loopback addresses')
  }
  if (url.username || url.password) throw new Error('MCP OAuth URLs cannot contain credentials')
  return url
}

const oauthFetch: FetchLike = async (input, init) => {
  secureOauthUrl(input)
  const timeout = AbortSignal.timeout(OAUTH_REQUEST_TIMEOUT_MS)
  const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout
  const response = await fetch(input, { ...init, redirect: 'manual', signal })
  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel()
    throw new Error('MCP OAuth endpoints cannot redirect server requests')
  }
  return response
}

export function mcpOauthPublicUrl(requestUrl: string) {
  const configured = process.env.OPENBOT_PUBLIC_URL
  const url = secureOauthUrl(configured ?? requestUrl)
  if (!configured && !isLoopback(url.hostname)) {
    throw new Error('OPENBOT_PUBLIC_URL is required for non-loopback MCP OAuth')
  }
  url.pathname = '/'
  url.search = ''
  url.hash = ''
  return url
}

async function discoverOauthServer(serverUrl: string) {
  const resourceServerUrl = secureOauthUrl(serverUrl)
  let resourceMetadata: OAuthProtectedResourceMetadata | undefined
  try {
    resourceMetadata = await discoverOAuthProtectedResourceMetadata(
      resourceServerUrl,
      undefined,
      oauthFetch,
    )
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes('does not implement')) throw error
    // Older MCP OAuth servers may not publish protected-resource metadata.
  }
  const authorizationServerUrl = secureOauthUrl(
    resourceMetadata?.authorization_servers?.[0] ?? new URL('/', resourceServerUrl),
  )
  const authorizationServerMetadata = await discoverAuthorizationServerMetadata(
    authorizationServerUrl,
    { fetchFn: oauthFetch },
  )
  if (authorizationServerMetadata) {
    if (
      secureOauthUrl(authorizationServerMetadata.issuer).toString() !==
      authorizationServerUrl.toString()
    ) {
      throw new Error('OAuth metadata issuer does not match the authorization server')
    }
    secureOauthUrl(authorizationServerMetadata.authorization_endpoint)
    secureOauthUrl(authorizationServerMetadata.token_endpoint)
    if (authorizationServerMetadata.registration_endpoint) {
      secureOauthUrl(authorizationServerMetadata.registration_endpoint)
    }
  }
  return {
    authorizationServerUrl: authorizationServerUrl.toString(),
    authorizationServerMetadata,
    resourceMetadata,
  }
}

function sdkClientInformation(
  flow: Pick<PreparedMcpOauthFlow, 'clientInformation' | 'redirectUrl'>,
): OAuthClientInformationMixed {
  const information = flow.clientInformation
  if (!information.token_endpoint_auth_method) return information
  return {
    ...information,
    redirect_uris: flow.redirectUrl ? [flow.redirectUrl] : [],
    token_endpoint_auth_method: information.token_endpoint_auth_method,
  }
}

async function prepareOauthFlow({
  serverUrl,
  redirectUrl,
  state,
}: PrepareMcpOauthInput): Promise<PreparedMcpOauthFlow> {
  secureOauthUrl(redirectUrl)
  const serverInfo = await discoverOauthServer(serverUrl)
  const scope = serverInfo.resourceMetadata?.scopes_supported?.join(' ')
  const clientMetadata = {
    client_name: 'OpenBot',
    redirect_uris: [redirectUrl],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
  }
  const registered = await registerClient(serverInfo.authorizationServerUrl, {
    metadata: serverInfo.authorizationServerMetadata,
    clientMetadata,
    scope,
    fetchFn: oauthFetch,
  })
  const resource = oauthResource(serverUrl, serverInfo.resourceMetadata)
  const { authorizationUrl, codeVerifier } = await startAuthorization(
    serverInfo.authorizationServerUrl,
    {
      metadata: serverInfo.authorizationServerMetadata,
      clientInformation: registered,
      redirectUrl,
      state,
      resource,
      scope,
    },
  )
  secureOauthUrl(authorizationUrl)
  const tokenEndpoint =
    serverInfo.authorizationServerMetadata?.token_endpoint ??
    new URL('/token', serverInfo.authorizationServerUrl).toString()
  return {
    state,
    authorizationUrl,
    codeVerifier,
    authorizationServerUrl: serverInfo.authorizationServerUrl,
    clientInformation: {
      client_id: registered.client_id,
      client_secret: registered.client_secret,
      token_endpoint_auth_method: registered.token_endpoint_auth_method,
    },
    authorizationServerMetadata: serverInfo.authorizationServerMetadata,
    resourceMetadata: serverInfo.resourceMetadata,
    resource,
    redirectUrl,
    tokenEndpoint,
    issuer:
      serverInfo.authorizationServerMetadata?.issuer ?? serverInfo.authorizationServerUrl,
    issuerRequired:
      (
        serverInfo.authorizationServerMetadata as
          | (AuthorizationServerMetadata & {
              authorization_response_iss_parameter_supported?: boolean
            })
          | undefined
      )?.authorization_response_iss_parameter_supported === true,
  }
}

function exchangeOauthCode(flow: PreparedMcpOauthFlow, code: string) {
  if (!flow.redirectUrl) throw new Error('OAuth callback URL is missing')
  return exchangeAuthorization(flow.authorizationServerUrl, {
    metadata: flow.authorizationServerMetadata,
    clientInformation: sdkClientInformation(flow),
    authorizationCode: code,
    codeVerifier: flow.codeVerifier,
    redirectUri: flow.redirectUrl,
    resource: flow.resource,
    fetchFn: oauthFetch,
  })
}

function credentialsFromTokens(
  tokens: McpOauthTokens,
  clientInformation: McpOauthClientInformation,
  now: number,
  binding: Pick<
    OauthCredentials,
    | 'resourceServerUrl'
    | 'authorizationServerUrl'
    | 'tokenEndpoint'
    | 'resource'
    | 'issuer'
  >,
  previous?: OauthCredentials,
): OauthCredentials {
  return {
    version: 1,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? previous?.refreshToken ?? null,
    tokenType: tokens.token_type,
    scope: tokens.scope
      ? tokens.scope.split(/\s+/).filter(Boolean)
      : (previous?.scope ?? []),
    expiresAt:
      tokens.expires_in === undefined
        ? null
        : now + Math.max(0, tokens.expires_in) * 1_000,
    clientId: clientInformation.client_id,
    clientSecret: clientInformation.client_secret ?? null,
    tokenEndpointAuthMethod: clientInformation.token_endpoint_auth_method ?? null,
    ...binding,
  }
}

export function createMcpOauthCoordinator(options: McpOauthCoordinatorOptions) {
  const now = options.now ?? Date.now
  const createState = options.state ?? (() => randomBytes(32).toString('base64url'))
  const pending = new Map<string, PendingMcpOauthFlow>()
  let preparing = 0

  return {
    async begin(input: { serverId: string; label: string; redirectUrl: string }) {
      for (const [state, flow] of pending) {
        if (flow.expiresAt < now()) {
          clearTimeout(flow.timeout)
          pending.delete(state)
        }
      }
      if (pending.size + preparing >= MAX_PENDING_OAUTH_FLOWS) {
        throw new Error('Too many pending MCP OAuth authorizations')
      }
      const label = input.label.trim()
      if (!label) throw new Error('OAuth account label is required')
      const redirectUrl = secureOauthUrl(input.redirectUrl)
      const server = await getMcpServer(input.serverId)
      if (!server) throw new Error(`MCP server ${input.serverId} not found`)

      const state = createState()
      let prepared: PreparedMcpOauthFlow
      preparing += 1
      try {
        prepared = await options.prepare({
          serverUrl: server.configurationJson.url,
          redirectUrl: redirectUrl.toString(),
          state,
        })
      } catch {
        throw new Error('Could not begin MCP OAuth authorization')
      } finally {
        preparing -= 1
      }
      if (prepared.state !== state || !prepared.codeVerifier) {
        throw new Error('Could not begin MCP OAuth authorization')
      }
      const timeout = setTimeout(() => pending.delete(state), OAUTH_FLOW_TTL_MS)
      timeout.unref()
      pending.set(state, {
        ...prepared,
        serverId: server.id,
        serverUrl: server.configurationJson.url,
        label,
        redirectUrl: redirectUrl.toString(),
        expiresAt: now() + OAUTH_FLOW_TTL_MS,
        timeout,
      })
      return { state, authorizationUrl: prepared.authorizationUrl.toString() }
    },

    async finish(input: { state: string; code: string; issuer?: string }) {
      const flow = pending.get(input.state)
      pending.delete(input.state)
      if (flow) clearTimeout(flow.timeout)
      if (!flow || flow.expiresAt < now()) {
        throw new Error('OAuth authorization is invalid or expired')
      }
      const expectedIssuer = flow.issuer ?? flow.authorizationServerUrl
      if (flow.issuerRequired && !input.issuer) {
        throw new Error('OAuth authorization issuer is required')
      }
      if (input.issuer && input.issuer !== expectedIssuer) {
        throw new Error('OAuth authorization issuer does not match')
      }
      if (!input.code) throw new Error('OAuth authorization code is required')

      try {
        const server = await getMcpServer(flow.serverId)
        if (!server || server.configurationJson.url !== flow.serverUrl) {
          throw new Error('MCP server changed during OAuth authorization')
        }
        const tokens = await options.exchange(flow, input.code)
        const tokenEndpoint =
          flow.tokenEndpoint ?? new URL('/token', flow.authorizationServerUrl).toString()
        return await createMcpOauthAccount({
          serverId: flow.serverId,
          label: flow.label,
          credentials: credentialsFromTokens(
            tokens,
            flow.clientInformation,
            now(),
            {
              resourceServerUrl: flow.serverUrl,
              authorizationServerUrl: flow.authorizationServerUrl,
              tokenEndpoint,
              resource: flow.resource?.toString() ?? null,
              issuer: expectedIssuer,
            },
          ),
        })
      } catch {
        throw new Error('Could not complete MCP OAuth authorization')
      }
    },

    reject(state: string) {
      const flow = pending.get(state)
      pending.delete(state)
      if (!flow) throw new Error('OAuth authorization is invalid or expired')
      clearTimeout(flow.timeout)
    },
  }
}

const oauthCoordinator = createMcpOauthCoordinator({
  prepare: prepareOauthFlow,
  exchange: exchangeOauthCode,
})

export const beginMcpOauthAuthorization = oauthCoordinator.begin
export const finishMcpOauthAuthorization = oauthCoordinator.finish
export const rejectMcpOauthAuthorization = oauthCoordinator.reject

type OauthRuntimeAccount = Extract<RuntimeMcpAccount, { authType: 'oauth' }>

async function refreshOauthTokens(account: OauthRuntimeAccount): Promise<McpOauthTokens> {
  const serverInfo = await discoverOauthServer(account.configuration.url)
  const tokenEndpoint =
    serverInfo.authorizationServerMetadata?.token_endpoint ??
    new URL('/token', serverInfo.authorizationServerUrl).toString()
  const resource = oauthResource(account.configuration.url, serverInfo.resourceMetadata)
  if (
    serverInfo.authorizationServerUrl !== account.credentials.authorizationServerUrl ||
    tokenEndpoint !== account.credentials.tokenEndpoint ||
    (resource?.toString() ?? null) !== account.credentials.resource ||
    (serverInfo.authorizationServerMetadata?.issuer ?? serverInfo.authorizationServerUrl) !==
      account.credentials.issuer
  ) {
    throw new Error('MCP OAuth authorization server changed')
  }
  return refreshAuthorization(serverInfo.authorizationServerUrl, {
    metadata: serverInfo.authorizationServerMetadata,
    clientInformation: sdkClientInformation({
      clientInformation: {
        client_id: account.credentials.clientId,
        client_secret: account.credentials.clientSecret ?? undefined,
        token_endpoint_auth_method:
          account.credentials.tokenEndpointAuthMethod ?? undefined,
      },
    }),
    refreshToken: account.credentials.refreshToken ?? '',
    resource,
    fetchFn: oauthFetch,
  })
}

export async function refreshExpiredMcpOauthAccount(
  account: RuntimeMcpAccount,
  options: {
    refresh?: (account: OauthRuntimeAccount) => Promise<McpOauthTokens>
    now?: () => number
  } = {},
): Promise<RuntimeMcpAccount> {
  if (account.authType !== 'oauth') return account
  const now = options.now ?? Date.now
  if (account.configuration.url !== account.credentials.resourceServerUrl) {
    throw new Error('MCP OAuth account requires authorization after the server URL changed')
  }
  if (
    account.credentials.expiresAt === null ||
    account.credentials.expiresAt > now() + OAUTH_REFRESH_SKEW_MS
  ) {
    return account
  }
  if (!account.credentials.refreshToken) {
    throw new Error('MCP OAuth account requires authorization')
  }

  let tokens: McpOauthTokens
  try {
    tokens = await (options.refresh ?? refreshOauthTokens)(account)
  } catch {
    throw new Error('Could not refresh MCP OAuth account')
  }
  const credentials = credentialsFromTokens(
    tokens,
    {
      client_id: account.credentials.clientId,
      client_secret: account.credentials.clientSecret ?? undefined,
      token_endpoint_auth_method: account.credentials.tokenEndpointAuthMethod ?? undefined,
    },
    now(),
    {
      resourceServerUrl: account.credentials.resourceServerUrl,
      authorizationServerUrl: account.credentials.authorizationServerUrl,
      tokenEndpoint: account.credentials.tokenEndpoint,
      resource: account.credentials.resource,
      issuer: account.credentials.issuer,
    },
    account.credentials,
  )
  const updated = await updateMcpOauthCredentials(account.accountId, credentials)
  if (!updated) throw new Error('MCP OAuth account not found')
  return { ...account, credentials }
}

const activeRefreshes = new Map<string, Promise<RuntimeMcpAccount>>()

export function refreshExpiredMcpOauthAccounts(accounts: RuntimeMcpAccount[]) {
  return Promise.all(
    accounts.map(async (account) => {
      try {
        const active = activeRefreshes.get(account.accountId)
        if (active) return await active
        const refresh = refreshExpiredMcpOauthAccount(account).finally(() => {
          activeRefreshes.delete(account.accountId)
        })
        activeRefreshes.set(account.accountId, refresh)
        return await refresh
      } catch {
        return undefined
      }
    }),
  ).then((refreshed) =>
    refreshed.filter((account): account is RuntimeMcpAccount => account !== undefined),
  )
}
