import { mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

const dataDirectory = mkdtempSync(path.join(os.tmpdir(), 'openbot-mcp-api-test-'))
process.env.OPENBOT_DATA_DIR = dataDirectory

type Handlers = typeof import('./mcp-handlers.server')
let handlers: Handlers

beforeAll(async () => {
  handlers = await import('./mcp-handlers.server')
})

describe('MCP server boundary', () => {
  it('never returns API-key credentials from normal configuration operations', async () => {
    const secret = 'api-boundary-secret'
    const server = await handlers.createServer({
      serverKey: 'safe-api',
      name: 'Safe API',
      transport: 'streamable_http',
      configuration: {
        version: 1,
        url: 'https://mcp.example.test/mcp',
        apiKeyHeader: 'X-API-Key',
        apiKeyPrefix: '',
      },
    })
    const account = await handlers.createAccount({
      serverId: server.id,
      label: 'Default',
      apiKey: secret,
    })

    expect(account).not.toHaveProperty('credentialsJson')
    expect(JSON.stringify(await handlers.readConfiguration())).not.toContain(secret)
  })

  it('never returns OAuth credentials from normal configuration operations', async () => {
    const database = await import('@openbot/db')
    const server = await handlers.createServer({
      serverKey: 'safe-oauth-api',
      name: 'Safe OAuth API',
      transport: 'streamable_http',
      configuration: {
        version: 1,
        url: 'https://oauth-mcp.example.test/mcp',
        apiKeyHeader: 'Authorization',
        apiKeyPrefix: 'Bearer',
      },
    })
    const accessToken = 'oauth-api-access-secret'
    const refreshToken = 'oauth-api-refresh-secret'
    await database.createMcpOauthAccount({
      serverId: server.id,
      label: 'OAuth',
      credentials: {
        version: 1,
        accessToken,
        refreshToken,
        tokenType: 'Bearer',
        scope: ['mcp:tools'],
        expiresAt: Date.now() + 60_000,
        clientId: 'oauth-api-client',
        clientSecret: 'oauth-api-client-secret',
        tokenEndpointAuthMethod: 'client_secret_post',
        resourceServerUrl: 'https://oauth-mcp.example.test/mcp',
        authorizationServerUrl: 'https://auth.example.test/',
        tokenEndpoint: 'https://auth.example.test/token',
        resource: 'https://oauth-mcp.example.test/mcp',
        issuer: 'https://auth.example.test/',
      },
    })

    const serialized = JSON.stringify(await handlers.readConfiguration())
    expect(serialized).not.toContain(accessToken)
    expect(serialized).not.toContain(refreshToken)
    expect(serialized).not.toContain('oauth-api-client-secret')
  })
})
