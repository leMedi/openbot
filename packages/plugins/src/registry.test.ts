import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { ModelToolCall, RuntimeMcpAccount } from '@openbot/db'
import { describe, expect, it, vi } from 'vitest'

process.env.OPENBOT_DATA_DIR ??= mkdtempSync(path.join(tmpdir(), 'openbot-plugin-tests-'))

const { createMcpToolRegistry } = await import('./registry')

function account(id: string, apiKey = `secret-${id}`): RuntimeMcpAccount {
  return {
    accountId: id,
    accountLabel: `Account ${id}`,
    serverId: 'server-linear',
    serverKey: 'linear',
    serverName: 'Linear',
    transport: 'streamable_http',
    configuration: {
      version: 1,
      url: 'https://example.com/mcp',
      apiKeyHeader: 'Authorization',
      apiKeyPrefix: 'Bearer',
    },
    authType: 'api_key',
    credentials: { version: 1, apiKey },
  }
}

function call(name: string, args: Record<string, unknown>): ModelToolCall {
  return {
    id: 'call-1',
    type: 'function',
    function: { name, arguments: JSON.stringify(args) },
  }
}

describe('MCP gateway', () => {
  it('connects lazily and reuses cached metadata in a later registry', async () => {
    const connect = vi.fn(async () => ({
      listTools: vi.fn(async () => ({
        tools: [{
          name: 'issue.create',
          description: 'Create an issue',
          inputSchema: { type: 'object' as const, properties: { title: { type: 'string' } } },
        }],
      })),
      callTool: vi.fn(async () => ({ content: [{ type: 'text', text: 'created' }] })),
      close: vi.fn(async () => {}),
    }))
    const first = createMcpToolRegistry([account('lazy-cache')], connect)

    expect(first.definitions.map((definition) => definition.function.name)).toEqual([
      'McpSearch',
      'McpDescribe',
      'McpCall',
    ])
    expect(connect).not.toHaveBeenCalled()

    const searched = JSON.parse(await first.execute(call('McpSearch', { query: 'issue' })))
    expect(connect).toHaveBeenCalledOnce()
    expect(searched.accounts).toEqual([
      expect.objectContaining({ account: 'Account lazy-cache', status: 'connected', toolCount: 1 }),
    ])
    expect(searched.tools).toHaveLength(1)
    await first.close()

    connect.mockClear()
    const second = createMcpToolRegistry([account('lazy-cache')], connect)
    const cached = JSON.parse(await second.execute(call('McpSearch', { query: 'issue' })))
    expect(connect).not.toHaveBeenCalled()
    expect(cached.accounts[0].status).toBe('cached')
  })

  it('returns account-specific references and describes their schemas', async () => {
    const connect = vi.fn(async () => ({
      listTools: async () => ({
        tools: [{
          name: 'search',
          description: 'Search this account',
          inputSchema: { type: 'object' as const, required: ['query'] },
        }],
      }),
      callTool: async () => ({}),
      close: async () => {},
    }))
    const registry = createMcpToolRegistry(
      [account('work-reference'), account('personal-reference')],
      connect,
    )
    const searched = JSON.parse(await registry.execute(call('McpSearch', { query: 'search' })))

    expect(searched.tools).toHaveLength(2)
    expect(searched.tools[0].tool).not.toBe(searched.tools[1].tool)
    const described = JSON.parse(await registry.execute(call('McpDescribe', {
      tool: searched.tools[1].tool,
    })))
    expect(described).toEqual(expect.objectContaining({
      account: 'Account personal-reference',
      name: 'search',
      inputSchema: { type: 'object', required: ['query'] },
    }))
  })

  it('reports discovery failures instead of hiding the account', async () => {
    const registry = createMcpToolRegistry(
      [account('failed-discovery')],
      async () => { throw new Error('service unavailable') },
    )
    const result = JSON.parse(await registry.execute(call('McpSearch', {})))

    expect(result.tools).toEqual([])
    expect(result.accounts).toEqual([{
      server: 'Linear',
      account: 'Account failed-discovery',
      status: 'failed',
      error: 'service unavailable',
    }])
  })

  it('discards a failed connection and retries the account on the next call', async () => {
    const closeFirst = vi.fn(async () => {})
    const callFirst = vi.fn(async () => { throw new Error('session expired') })
    const callSecond = vi.fn(async () => ({ ok: true }))
    let attempt = 0
    const registry = createMcpToolRegistry([account('call-retry')], async () => {
      attempt++
      return {
        listTools: async () => ({
          tools: [{ name: 'create_issue', inputSchema: { type: 'object' } }],
        }),
        callTool: attempt === 1 ? callFirst : callSecond,
        close: attempt === 1 ? closeFirst : async () => {},
      }
    })
    const searched = JSON.parse(await registry.execute(call('McpSearch', {})))
    const tool = searched.tools[0].tool

    const failed = JSON.parse(await registry.execute(call('McpCall', {
      tool,
      arguments: { title: 'One' },
    })))
    expect(failed).toEqual(expect.objectContaining({ status: 'failed', error: 'session expired' }))
    expect(closeFirst).toHaveBeenCalledOnce()

    const succeeded = JSON.parse(await registry.execute(call('McpCall', {
      tool,
      arguments: { title: 'One' },
    })))
    expect(succeeded).toEqual(expect.objectContaining({ status: 'connected', result: { ok: true } }))
    expect(callSecond).toHaveBeenCalledWith('create_issue', { title: 'One' }, expect.any(AbortSignal))
  })

  it('redacts account credentials from metadata, errors, and results', async () => {
    const secret = 'do-not-leak'
    const registry = createMcpToolRegistry([account('redaction', secret)], async () => ({
      listTools: async () => ({
        tools: [{
          name: 'inspect',
          description: `Never show ${secret}`,
          inputSchema: { type: 'object', description: secret },
        }],
      }),
      callTool: async () => ({ token: secret }),
      close: async () => {},
    }))
    const searchedText = await registry.execute(call('McpSearch', {}))
    const searched = JSON.parse(searchedText)
    const describedText = await registry.execute(call('McpDescribe', { tool: searched.tools[0].tool }))
    const calledText = await registry.execute(call('McpCall', {
      tool: searched.tools[0].tool,
      arguments: {},
    }))

    expect(`${searchedText}${describedText}${calledText}`).not.toContain(secret)
    expect(`${searchedText}${describedText}${calledText}`).toContain('[REDACTED]')
  })

  it('prepares OAuth-style credentials lazily and reports preparation failures', async () => {
    const prepare = vi.fn(async () => { throw new Error('authorization expired') })
    const connect = vi.fn(async () => ({
      listTools: async () => ({ tools: [] }),
      callTool: async () => ({}),
      close: async () => {},
    }))
    const registry = createMcpToolRegistry(
      [account('lazy-auth')],
      connect,
      prepare,
    )

    expect(prepare).not.toHaveBeenCalled()
    const searched = JSON.parse(await registry.execute(call('McpSearch', {})))
    expect(prepare).toHaveBeenCalledOnce()
    expect(connect).not.toHaveBeenCalled()
    expect(searched.accounts[0]).toEqual(expect.objectContaining({
      status: 'failed',
      error: 'authorization expired',
    }))
  })

  it('does not return stale tools after an explicit refresh fails', async () => {
    let listAttempt = 0
    const registry = createMcpToolRegistry([account('refresh-failure')], async () => ({
      listTools: async () => {
        listAttempt++
        if (listAttempt > 1) throw new Error('refresh failed')
        return { tools: [{ name: 'stale_tool', inputSchema: { type: 'object' } }] }
      },
      callTool: async () => ({}),
      close: async () => {},
    }))
    const initial = JSON.parse(await registry.execute(call('McpSearch', {})))
    expect(initial.tools).toHaveLength(1)

    const refreshed = JSON.parse(await registry.execute(call('McpSearch', { refresh: true })))
    expect(refreshed.tools).toEqual([])
    expect(refreshed.accounts[0]).toEqual(expect.objectContaining({
      status: 'failed',
      error: 'refresh failed',
    }))
  })

  it('shares concurrent connection and metadata work for one account', async () => {
    let release: (() => void) | undefined
    const blocked = new Promise<void>((resolve) => { release = resolve })
    const listTools = vi.fn(async () => {
      await blocked
      return { tools: [{ name: 'shared_tool', inputSchema: { type: 'object' as const } }] }
    })
    const connect = vi.fn(async () => ({
      listTools,
      callTool: async () => ({}),
      close: async () => {},
    }))
    const registry = createMcpToolRegistry([account('concurrent')], connect)
    const first = registry.execute(call('McpSearch', {}))
    const second = registry.execute(call('McpSearch', {}))
    release?.()
    await Promise.all([first, second])

    expect(connect).toHaveBeenCalledOnce()
    expect(listTools).toHaveBeenCalledOnce()
  })

  it('surfaces protocol-level MCP tool failures', async () => {
    const registry = createMcpToolRegistry([account('protocol-error')], async () => ({
      listTools: async () => ({
        tools: [{ name: 'fail_tool', inputSchema: { type: 'object' } }],
      }),
      callTool: async () => ({ isError: true, content: [{ type: 'text', text: 'denied' }] }),
      close: async () => {},
    }))
    const searched = JSON.parse(await registry.execute(call('McpSearch', {})))
    const result = JSON.parse(await registry.execute(call('McpCall', {
      tool: searched.tools[0].tool,
      arguments: {},
    })))

    expect(result).toEqual(expect.objectContaining({
      status: 'connected',
      toolStatus: 'failed',
      error: 'MCP tool reported a failure',
    }))
  })
})
