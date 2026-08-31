import { mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type {
  PrepareMcpOauthInput,
  PreparedMcpOauthFlow,
} from './mcp-oauth.server'

process.env.OPENBOT_DATA_DIR = mkdtempSync(path.join(os.tmpdir(), 'openbot-mcp-oauth-test-'))

type DbModule = typeof import('@openbot/db')
type OauthModule = typeof import('./mcp-oauth.server')
let database: DbModule
let oauth: OauthModule

beforeAll(async () => {
  database = await import('@openbot/db')
  oauth = await import('./mcp-oauth.server')
})

const configuration = {
  version: 1 as const,
  url: 'https://mcp.example.test/mcp',
  apiKeyHeader: 'Authorization',
  apiKeyPrefix: 'Bearer' as const,
}

describe('MCP OAuth authorization', () => {
  it('validates in-memory state and PKCE before persisting safe account metadata', async () => {
    const server = await database.createMcpServer({
      serverKey: 'oauth-flow',
      name: 'OAuth Flow MCP',
      transport: 'streamable_http',
      configuration,
    })
    const exchange = vi.fn(async (flow: PreparedMcpOauthFlow, code: string) => {
      expect(flow.codeVerifier).toBe('pkce-verifier')
      expect(code).toBe('authorization-code')
      return {
        access_token: 'callback-access-secret',
        refresh_token: 'callback-refresh-secret',
        token_type: 'Bearer',
        expires_in: 300,
        scope: 'mcp:tools offline_access',
      }
    })
    const coordinator = oauth.createMcpOauthCoordinator({
      prepare: async ({ state }) => ({
        state,
        authorizationUrl: new URL(`https://auth.example.test/authorize?state=${state}`),
        codeVerifier: 'pkce-verifier',
        authorizationServerUrl: 'https://auth.example.test',
        clientInformation: {
          client_id: 'dynamic-client',
          client_secret: 'dynamic-client-secret',
          token_endpoint_auth_method: 'client_secret_post',
        },
        issuer: 'https://auth.example.test',
      }),
      exchange,
      now: () => 1_000,
    })

    const started = await coordinator.begin({
      serverId: server.id,
      label: 'OAuth Account',
      redirectUrl: 'https://openbot.example.test/api/mcp/oauth/callback',
    })
    await expect(
      coordinator.finish({ state: 'wrong-state', code: 'authorization-code' }),
    ).rejects.toThrow(/invalid or expired/i)

    await expect(
      coordinator.finish({
        state: started.state,
        code: 'authorization-code',
        issuer: 'https://attacker.example.test',
      }),
    ).rejects.toThrow(/issuer/i)
    expect(exchange).not.toHaveBeenCalled()

    const restarted = await coordinator.begin({
      serverId: server.id,
      label: 'OAuth Account',
      redirectUrl: 'https://openbot.example.test/api/mcp/oauth/callback',
    })

    const account = await coordinator.finish({
      state: restarted.state,
      code: 'authorization-code',
      issuer: 'https://auth.example.test',
    })
    expect(exchange).toHaveBeenCalledOnce()
    expect(account).toMatchObject({ authType: 'oauth', label: 'OAuth Account' })
    expect(account.tokenExpiresAt).toBe(301_000)
    expect(JSON.stringify(account)).not.toContain('callback-access-secret')
    await expect(
      coordinator.finish({ state: restarted.state, code: 'authorization-code' }),
    ).rejects.toThrow(/invalid or expired/i)
  })

  it('invalidates unfinished authorization when the coordinator restarts', async () => {
    const server = await database.createMcpServer({
      serverKey: 'oauth-restart',
      name: 'OAuth Restart MCP',
      transport: 'streamable_http',
      configuration,
    })
    const operations = {
      prepare: async ({ state }: PrepareMcpOauthInput) => ({
        state,
        authorizationUrl: new URL(`https://auth.example.test/authorize?state=${state}`),
        codeVerifier: 'restart-verifier',
        authorizationServerUrl: 'https://auth.example.test',
        clientInformation: { client_id: 'restart-client' },
      }),
      exchange: vi.fn(),
    }
    const existing = await database.createMcpApiKeyAccount({
      serverId: server.id,
      label: 'Existing API key',
      apiKey: 'existing-secret',
    })
    const beforeRestart = oauth.createMcpOauthCoordinator(operations)
    const started = await beforeRestart.begin({
      serverId: server.id,
      label: 'Interrupted',
      redirectUrl: 'https://openbot.example.test/api/mcp/oauth/callback',
    })

    const afterRestart = oauth.createMcpOauthCoordinator(operations)
    await expect(
      afterRestart.finish({ state: started.state, code: 'unused-code' }),
    ).rejects.toThrow(/invalid or expired/i)
    expect(operations.exchange).not.toHaveBeenCalled()
    const accounts = await database.listMcpAccounts(server.id)
    expect(accounts.map((item) => item.id)).toContain(existing.id)
    expect(accounts.map((item) => item.label)).not.toContain('Interrupted')
  })

  it('refreshes expired OAuth credentials and persists replacements', async () => {
    const server = await database.createMcpServer({
      serverKey: 'oauth-refresh',
      name: 'OAuth Refresh MCP',
      transport: 'streamable_http',
      configuration,
    })
    const { agent } = await database.createAgent({ name: 'OAuth Agent' })
    const account = await database.createMcpOauthAccount({
      serverId: server.id,
      label: 'Expired OAuth',
      credentials: {
        version: 1,
        accessToken: 'expired-access-secret',
        refreshToken: 'durable-refresh-secret',
        tokenType: 'Bearer',
        scope: ['mcp:tools'],
        expiresAt: 1_000,
        clientId: 'refresh-client',
        clientSecret: null,
        tokenEndpointAuthMethod: 'none',
        resourceServerUrl: configuration.url,
        authorizationServerUrl: 'https://auth.example.test/',
        tokenEndpoint: 'https://auth.example.test/token',
        resource: configuration.url,
        issuer: 'https://auth.example.test/',
      },
    })
    await database.setAgentMcpAccounts(agent.id, [account.id])
    const [runtime] = await database.listRuntimeMcpAccountsForAgent(agent.id)
    const refresh = vi.fn(async () => ({
      access_token: 'replacement-access-secret',
      refresh_token: 'replacement-refresh-secret',
      token_type: 'Bearer',
      expires_in: 600,
      scope: 'mcp:tools',
    }))

    const refreshed = await oauth.refreshExpiredMcpOauthAccount(runtime, {
      refresh,
      now: () => 2_000,
    })
    expect(refresh).toHaveBeenCalledOnce()
    expect(refreshed.authType).toBe('oauth')
    if (refreshed.authType !== 'oauth') throw new Error('Expected OAuth account')
    expect(refreshed.credentials.accessToken).toBe('replacement-access-secret')
    expect(refreshed.credentials.expiresAt).toBe(602_000)

    const [persisted] = await database.listRuntimeMcpAccountsForAgent(agent.id)
    if (persisted.authType !== 'oauth') throw new Error('Expected persisted OAuth account')
    expect(persisted.credentials.accessToken).toBe('replacement-access-secret')
    expect(persisted.credentials.refreshToken).toBe('replacement-refresh-secret')
  })

  it('does not send persisted OAuth credentials to a changed MCP URL', async () => {
    const server = await database.createMcpServer({
      serverKey: 'oauth-binding',
      name: 'OAuth Binding MCP',
      transport: 'streamable_http',
      configuration,
    })
    const account = await database.createMcpOauthAccount({
      serverId: server.id,
      label: 'Bound OAuth',
      credentials: {
        version: 1,
        accessToken: 'bound-access-secret',
        refreshToken: 'bound-refresh-secret',
        tokenType: 'Bearer',
        scope: ['mcp:tools'],
        expiresAt: 1_000,
        clientId: 'bound-client',
        clientSecret: null,
        tokenEndpointAuthMethod: 'none',
        resourceServerUrl: configuration.url,
        authorizationServerUrl: 'https://auth.example.test/',
        tokenEndpoint: 'https://auth.example.test/token',
        resource: configuration.url,
        issuer: 'https://auth.example.test/',
      },
    })
    const { agent } = await database.createAgent({ name: 'Bound OAuth Agent' })
    await database.setAgentMcpAccounts(agent.id, [account.id])
    const [runtime] = await database.listRuntimeMcpAccountsForAgent(agent.id)
    const refresh = vi.fn()

    await expect(
      oauth.refreshExpiredMcpOauthAccount(
        {
          ...runtime,
          configuration: { ...runtime.configuration, url: 'https://moved.example.test/mcp' },
        },
        { refresh, now: () => 2_000 },
      ),
    ).rejects.toThrow(/authorization/i)
    expect(refresh).not.toHaveBeenCalled()
  })
})
