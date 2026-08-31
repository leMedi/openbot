import { mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { RuntimeMcpAccount } from '@openbot/db'
import type { McpClientConnection } from './mcp-tools'

process.env.OPENBOT_DATA_DIR = mkdtempSync(path.join(os.tmpdir(), 'openbot-mcp-tools-test-'))

let createMcpToolRegistry: typeof import('./mcp-tools').createMcpToolRegistry

beforeAll(async () => {
  ;({ createMcpToolRegistry } = await import('./mcp-tools'))
})

const account: RuntimeMcpAccount = {
  accountId: 'acc_0123456789abcdef',
  accountLabel: 'Production',
  serverId: 'mcp_server',
  serverKey: 'example',
  serverName: 'Example MCP',
  transport: 'streamable_http',
  configuration: {
    version: 1,
    url: 'https://mcp.example.test/mcp',
    apiKeyHeader: 'Authorization',
    apiKeyPrefix: 'Bearer',
  },
  credentials: { version: 1, apiKey: 'runtime-secret' },
}

describe('per-turn MCP tools', () => {
  it('discovers, namespaces, executes, redacts, and closes tools', async () => {
    const close = vi.fn(async () => {})
    const callTool = vi.fn(async () => ({
      content: [{ type: 'text', text: 'result included runtime-secret' }],
      isError: false,
    }))
    const connection: McpClientConnection = {
      listTools: vi.fn(async () => ({
        tools: [
          {
            name: 'search-runtime-secret',
            description: 'Search without exposing runtime-secret',
            inputSchema: {
              type: 'object' as const,
              properties: {
                'runtime-secret-query': { type: 'string' },
              },
            },
          },
        ],
      })),
      callTool,
      close,
    }
    const registry = await createMcpToolRegistry([account], async () => connection)

    expect(registry.definitions).toHaveLength(1)
    const name = registry.definitions[0].function.name
    expect(name).toMatch(/^mcp_example_[a-f0-9]{8}_search-_REDACTED_$/)
    expect(JSON.stringify(registry.definitions)).not.toContain('runtime-secret')
    expect(
      await registry.execute({
        id: 'call_1',
        type: 'function',
        function: { name, arguments: '{"query":"open"}' },
      }),
    ).not.toContain('runtime-secret')
    expect(callTool).toHaveBeenCalledWith(
      'search-runtime-secret',
      { query: 'open' },
      undefined,
    )

    await registry.close()
    expect(close).toHaveBeenCalledOnce()
  })

  it('isolates an unavailable account while keeping other tools', async () => {
    const second = { ...account, accountId: 'acc_second', accountLabel: 'Second' }
    const registry = await createMcpToolRegistry([account, second], async (candidate) => {
      if (candidate.accountId === account.accountId) throw new Error('runtime-secret failed')
      return {
        listTools: async () => ({
          tools: [{ name: 'healthy', inputSchema: { type: 'object' } }],
        }),
        callTool: async () => ({ content: [] }),
        close: async () => {},
      }
    })
    expect(registry.definitions.map((definition) => definition.function.name)).toHaveLength(1)
  })
})
