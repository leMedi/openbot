import { mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

const dataDirectory = mkdtempSync(path.join(os.tmpdir(), 'openbot-mcp-test-'))
process.env.OPENBOT_DATA_DIR = dataDirectory

type DbModule = typeof import('./index')
let database: DbModule

beforeAll(async () => {
  database = await import('./index')
})

const configuration = {
  version: 1 as const,
  url: 'https://mcp.example.test/mcp',
  apiKeyHeader: 'Authorization',
  apiKeyPrefix: 'Bearer' as const,
}

describe('MCP configuration', () => {
  it('manages servers and returns only safe account metadata', async () => {
    const secret = 'secret-that-must-not-cross-the-api'
    const server = await database.createMcpServer({
      serverKey: 'example',
      name: 'Example MCP',
      transport: 'streamable_http',
      configuration,
    })
    expect(server.id).toMatch(/^mcp_/)
    expect(await database.listMcpServers()).toContainEqual(server)

    const account = await database.createMcpApiKeyAccount({
      serverId: server.id,
      label: 'Production',
      apiKey: secret,
    })
    expect(account.id).toMatch(/^acc_/)
    expect(account).not.toHaveProperty('credentialsJson')
    expect(JSON.stringify(await database.listMcpAccounts())).not.toContain(secret)

    const renamed = await database.updateMcpAccount(account.id, {
      label: 'Primary',
      apiKey: 'replacement-secret',
    })
    expect(renamed?.label).toBe('Primary')
    expect(renamed).not.toHaveProperty('credentialsJson')

    const disabled = await database.updateMcpServer(server.id, { enabled: false })
    expect(disabled?.enabled).toBe(false)
    expect(await database.deleteMcpAccount(account.id)).toBe(true)
    expect(await database.deleteMcpAccount(account.id)).toBe(false)
    expect(await database.deleteMcpServer(server.id)).toBe(true)
  })

  it('validates API-key credentials and non-secret transport configuration', async () => {
    await expect(
      database.createMcpServer({
        serverKey: 'unsafe',
        name: 'Unsafe MCP',
        transport: 'streamable_http',
        configuration: { ...configuration, url: 'https://token@example.test/mcp' },
      }),
    ).rejects.toThrow()

    const server = await database.createMcpServer({
      serverKey: 'validation',
      name: 'Validation MCP',
      transport: 'streamable_http',
      configuration,
    })
    await expect(
      database.createMcpApiKeyAccount({ serverId: server.id, label: 'Empty', apiKey: '' }),
    ).rejects.toThrow()
    await expect(
      database.createMcpApiKeyAccount({
        serverId: server.id,
        label: 'Header injection',
        apiKey: 'secret\r\ninjected: value',
      }),
    ).rejects.toThrow(/invalid characters/i)

    await database.createMcpApiKeyAccount({
      serverId: server.id,
      label: 'Duplicate',
      apiKey: 'first-duplicate-secret',
    })
    const secondSecret = 'second-duplicate-secret'
    const duplicateError = await database
      .createMcpApiKeyAccount({
        serverId: server.id,
        label: 'Duplicate',
        apiKey: secondSecret,
      })
      .catch((error: unknown) => error)
    expect(duplicateError).toBeInstanceOf(Error)
    expect((duplicateError as Error).message).not.toContain(secondSecret)
  })

  it('replaces agent grants and exposes credentials only through the runtime query', async () => {
    const { agent: alpha } = await database.createAgent({ name: 'MCP Alpha' })
    const { agent: beta } = await database.createAgent({ name: 'MCP Beta' })
    const server = await database.createMcpServer({
      serverKey: 'runtime',
      name: 'Runtime MCP',
      transport: 'streamable_http',
      configuration,
    })
    const first = await database.createMcpApiKeyAccount({
      serverId: server.id,
      label: 'First',
      apiKey: 'first-runtime-secret',
    })
    const second = await database.createMcpApiKeyAccount({
      serverId: server.id,
      label: 'Second',
      apiKey: 'second-runtime-secret',
    })

    await database.setAgentMcpAccounts(alpha.id, [first.id, second.id])
    expect((await database.listAgentMcpAccounts(alpha.id)).map((item) => item.id)).toEqual(
      expect.arrayContaining([first.id, second.id]),
    )
    expect(await database.listAgentMcpAccounts(beta.id)).toEqual([])

    const runtime = await database.listRuntimeMcpAccountsForAgent(alpha.id)
    expect(runtime.map((item) => item.credentials.apiKey)).toEqual(
      expect.arrayContaining(['first-runtime-secret', 'second-runtime-secret']),
    )
    expect(await database.listRuntimeMcpAccountsForAgent(beta.id)).toEqual([])

    await database.setAgentMcpAccounts(alpha.id, [second.id])
    expect((await database.listAgentMcpAccounts(alpha.id)).map((item) => item.id)).toEqual([
      second.id,
    ])

    await database.updateMcpServer(server.id, { enabled: false })
    expect(await database.listRuntimeMcpAccountsForAgent(alpha.id)).toEqual([])
  })

  it('rejects duplicate or unknown grants', async () => {
    const { agent } = await database.createAgent({ name: 'MCP Grants' })
    await expect(
      database.setAgentMcpAccounts(agent.id, ['acc_missing']),
    ).rejects.toThrow(/acc_missing/)
    await expect(
      database.setAgentMcpAccounts(agent.id, ['acc_same', 'acc_same']),
    ).rejects.toThrow(/duplicate/i)
  })

  it('saves agent profiles and MCP grants atomically', async () => {
    const server = await database.createMcpServer({
      serverKey: 'atomic',
      name: 'Atomic MCP',
      transport: 'streamable_http',
      configuration,
    })
    const account = await database.createMcpApiKeyAccount({
      serverId: server.id,
      label: 'Atomic account',
      apiKey: 'atomic-secret',
    })
    const { agent } = await database.createAgent({ name: 'Atomic agent' }, [account.id])
    expect((await database.listAgentMcpAccounts(agent.id)).map((item) => item.id)).toEqual([
      account.id,
    ])

    await expect(
      database.updateAgentProfileAndMcpAccounts(
        agent.id,
        { name: 'Must roll back' },
        ['acc_missing'],
      ),
    ).rejects.toThrow(/acc_missing/)
    expect((await database.getAgent(agent.id))?.name).toBe('Atomic agent')
  })
})
