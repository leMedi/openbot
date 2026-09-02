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

describe('direct MCP tools', () => {
  it('discovers schemas, closes discovery, and reconnects lazily for invocation', async () => {
    const discoveryClose = vi.fn(async () => {})
    const invoke = vi.fn(async () => ({ ok: true }))
    let connection = 0
    const connect = vi.fn(async () => {
      connection++
      return {
        listTools: async () => ({
          tools: [{
            name: 'issue.create',
            description: 'Create an issue',
            inputSchema: { type: 'object' as const, required: ['title'] },
          }],
        }),
        callTool: invoke,
        close: connection === 1 ? discoveryClose : async () => {},
      }
    })
    const registry = await createMcpToolRegistry([account('direct-lazy')], connect)

    expect(connect).toHaveBeenCalledOnce()
    expect(discoveryClose).toHaveBeenCalledOnce()
    expect(registry.definitions).toHaveLength(1)
    expect(registry.definitions[0]?.function).toEqual(expect.objectContaining({
      description: '[Linear / Account direct-lazy] Create an issue',
      parameters: { type: 'object', required: ['title'] },
    }))

    const toolName = registry.definitions[0]!.function.name
    expect(JSON.parse(await registry.execute(call(toolName, { title: 'One' })))).toEqual({ ok: true })
    expect(connect).toHaveBeenCalledTimes(2)
    expect(invoke).toHaveBeenCalledWith('issue.create', { title: 'One' }, expect.any(AbortSignal))
  })

  it('uses cached metadata without reconnecting on a later turn', async () => {
    const id = 'metadata-cache-direct'
    const firstConnect = vi.fn(async () => ({
      listTools: async () => ({
        tools: [{ name: 'search', inputSchema: { type: 'object' as const } }],
      }),
      callTool: async () => ({}),
      close: async () => {},
    }))
    await createMcpToolRegistry([account(id)], firstConnect)

    const secondConnect = vi.fn(async () => { throw new Error('should stay lazy') })
    const second = await createMcpToolRegistry([account(id)], secondConnect)
    expect(secondConnect).not.toHaveBeenCalled()
    expect(second.definitions).toHaveLength(1)
  })

  it('creates distinct direct tool names for multiple accounts', async () => {
    const registry = await createMcpToolRegistry(
      [account('work-direct'), account('personal-direct')],
      async () => ({
        listTools: async () => ({
          tools: [{ name: 'search', inputSchema: { type: 'object' as const } }],
        }),
        callTool: async () => ({}),
        close: async () => {},
      }),
    )
    expect(registry.definitions).toHaveLength(2)
    expect(registry.definitions[0]?.function.name).not.toBe(
      registry.definitions[1]?.function.name,
    )
  })

  it('omits accounts whose metadata discovery fails', async () => {
    const registry = await createMcpToolRegistry(
      [account('failed-direct')],
      async () => { throw new Error('unavailable') },
    )
    expect(registry.definitions).toEqual([])
  })

  it('redacts credentials from schemas and results', async () => {
    const secret = 'do-not-leak'
    const registry = await createMcpToolRegistry([account('redaction-direct', secret)], async () => ({
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
    const definitionText = JSON.stringify(registry.definitions)
    const resultText = await registry.execute(call(registry.definitions[0]!.function.name, {}))
    expect(`${definitionText}${resultText}`).not.toContain(secret)
    expect(`${definitionText}${resultText}`).toContain('[REDACTED]')
  })

  it('keeps oversized results valid JSON', async () => {
    const registry = await createMcpToolRegistry([account('large-direct')], async () => ({
      listTools: async () => ({
        tools: [{ name: 'large', inputSchema: { type: 'object' } }],
      }),
      callTool: async () => ({ content: 'x'.repeat(60_000) }),
      close: async () => {},
    }))
    const text = await registry.execute(call(registry.definitions[0]!.function.name, {}))
    expect(JSON.parse(text)).toEqual(expect.objectContaining({ truncated: true }))
  })

  it('revalidates the account grant before invoking a direct tool', async () => {
    const invoke = vi.fn(async () => ({ ok: true }))
    const registry = await createMcpToolRegistry(
      [account('revoked-direct')],
      async () => ({
        listTools: async () => ({
          tools: [{ name: 'private_tool', inputSchema: { type: 'object' } }],
        }),
        callTool: invoke,
        close: async () => {},
      }),
      async (value) => value,
      async () => false,
    )
    const result = JSON.parse(
      await registry.execute(call(registry.definitions[0]!.function.name, {})),
    )

    expect(result.error).toContain('no longer granted')
    expect(invoke).not.toHaveBeenCalled()
  })
})
