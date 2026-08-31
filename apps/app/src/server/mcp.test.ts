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
})
