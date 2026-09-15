import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'

process.env.OPENBOT_DATA_DIR ??= mkdtempSync(path.join(tmpdir(), 'openbot-oauth-tests-'))

const { createMcpServer } = await import('@openbot/db')
const { createMcpOauthCoordinator, McpOauthError } = await import('./oauth')

it('returns the durable turn continuation with the connected account', async () => {
  const server = await createMcpServer({
    serverKey: 'oauth-continuation-test',
    name: 'OAuth continuation test',
    transport: 'streamable_http',
    configuration: {
      version: 1,
      url: 'https://mcp.example.test/mcp',
      apiKeyHeader: 'Authorization',
      apiKeyPrefix: 'Bearer',
    },
  })
  const coordinator = createMcpOauthCoordinator({
    prepare: async ({ redirectUrl, state }) => ({
      state,
      authorizationUrl: new URL('https://auth.example.test/authorize'),
      codeVerifier: 'verifier',
      authorizationServerUrl: 'https://auth.example.test/',
      clientInformation: { client_id: 'client' },
      redirectUrl,
      tokenEndpoint: 'https://auth.example.test/token',
      issuer: 'https://auth.example.test/',
    }),
    exchange: async () => ({ access_token: 'access-token', token_type: 'Bearer' }),
    state: () => 'oauth-state',
  })
  const continuation = {
    turnId: 'turn-1',
    toolCallId: 'tool-1',
    agentId: 'agent-1',
    pluginKey: 'clickup',
  }

  const started = await coordinator.begin({
    serverId: server.id,
    label: 'account 1',
    redirectUrl: 'https://openbot.example.test/api/mcp/oauth/callback',
    continuation,
  })
  const completed = await coordinator.finish({ state: started.state, code: 'code' })

  expect(completed.account).toEqual(expect.objectContaining({ serverId: server.id }))
  expect(completed.continuation).toEqual(continuation)
})

it('keeps the authorization start failure and its cause diagnosable', async () => {
  const server = await createMcpServer({
    serverKey: 'oauth-error-test',
    name: 'OAuth error test',
    transport: 'streamable_http',
    configuration: {
      version: 1,
      url: 'https://mcp-error.example.test/mcp',
      apiKeyHeader: 'Authorization',
      apiKeyPrefix: 'Bearer',
    },
  })
  const cause = new Error('Provider discovery failed')
  const coordinator = createMcpOauthCoordinator({
    prepare: async () => { throw cause },
    exchange: async () => ({ access_token: 'unused', token_type: 'Bearer' }),
  })

  await expect(coordinator.begin({
    serverId: server.id,
    label: 'default',
    redirectUrl: 'https://openbot.example.test/api/mcp/oauth/callback',
  })).rejects.toMatchObject({
    name: 'McpOauthError',
    code: 'authorization-start-failed',
    cause,
  } satisfies Partial<InstanceType<typeof McpOauthError>>)
})
