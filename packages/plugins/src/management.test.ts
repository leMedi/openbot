import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { ModelToolCall, WaitingState } from '@openbot/db'
import { describe, expect, it, vi } from 'vitest'

process.env.OPENBOT_DATA_DIR ??= mkdtempSync(path.join(tmpdir(), 'openbot-management-tests-'))

const { createAgent, createMcpApiKeyAccount, listAgentMcpAccounts } = await import('@openbot/db')
const { createMcpManagementTools } = await import('./management')
const { installCatalogServer } = await import('./handlers')

function call(name: string, args: Record<string, unknown>): ModelToolCall {
  return {
    id: 'management-call',
    type: 'function',
    function: { name, arguments: JSON.stringify(args) },
  }
}

describe('MCP management tools', () => {
  it('searches the full catalog, including uninstalled plugins', async () => {
    const tools = createMcpManagementTools('unused-agent', { suspend: vi.fn() })
    const result = await tools.execute(call('SearchPlugins', { query: 'Linear' }))

    expect(tools.definitions.map((definition) => definition.function.name)).toEqual([
      'SearchPlugins',
      'GetPlugin',
      'InstallPlugin',
    ])
    expect(result).toContain('linear: Linear')
    expect(result).toContain('installed=no')
  })

  it('requires durable approval and refuses credentials in tool arguments', async () => {
    let waiting: WaitingState | undefined
    const suspend = vi.fn(async (state: WaitingState) => { waiting = state })
    const tools = createMcpManagementTools('unused-agent', { suspend })
    const rejected = await tools.execute(call('InstallPlugin', {
      plugin_id: 'linear',
      values: { api_key: 'super-secret' },
    }))
    expect(rejected).toContain('Enter credentials in the Plugins UI')
    expect(suspend).not.toHaveBeenCalled()

    const args = { plugin_id: 'linear' }
    const result = await tools.execute(call('InstallPlugin', args))

    expect(result).toContain('Waiting for the user')
    expect(waiting?.originatingToolCall.name).toBe('InstallPlugin')
    expect(waiting?.resumeData).toEqual(expect.objectContaining({
      pluginId: 'linear',
      valuesHash: expect.any(String),
    }))
  })

  it('installs and atomically grants an existing account after approval', async () => {
    const { agent } = await createAgent({ name: 'Plugin manager test' })
    const server = await installCatalogServer({ key: 'linear' })
    const account = await createMcpApiKeyAccount({
      serverId: server.id,
      label: 'Approved Work',
      apiKey: 'approved-key',
    })
    let waiting: WaitingState | undefined
    const args = {
      plugin_id: 'linear',
      values: { account_id: account.id },
    }
    const first = createMcpManagementTools(agent.id, {
      suspend: async (state) => { waiting = state },
    })
    await first.execute(call('InstallPlugin', args))
    const resumeData = waiting!.resumeData as { pluginId: string; valuesHash: string }
    const approved = createMcpManagementTools(agent.id, {
      approval: { ...resumeData, approved: true },
      suspend: vi.fn(),
    })
    const result = await approved.execute(call('InstallPlugin', args))

    expect(result).toContain('Installed Linear (plugin linear).')
    expect(result).toContain('New MCP tools become available on the next message.')
    expect(await listAgentMcpAccounts(agent.id)).toEqual([
      expect.objectContaining({ label: 'Approved Work' }),
    ])
  })

  it('rejects a mismatched account before requesting approval', async () => {
    const suspend = vi.fn()
    const tools = createMcpManagementTools('unused-agent', { suspend })

    const result = await tools.execute(call('InstallPlugin', {
      plugin_id: 'linear',
      values: { account_id: 'account-from-another-plugin' },
    }))

    expect(result).toContain('does not belong to Linear')
    expect(suspend).not.toHaveBeenCalled()
  })

  it('consumes a matching approval after one install attempt', async () => {
    const { agent } = await createAgent({ name: 'One-shot approval test' })
    let waiting: WaitingState | undefined
    const args = { plugin_id: 'linear' }
    const initial = createMcpManagementTools(agent.id, {
      suspend: async (state) => { waiting = state },
    })
    await initial.execute(call('InstallPlugin', args))
    const resumeData = waiting!.resumeData as { pluginId: string; valuesHash: string }
    const suspend = vi.fn()
    const approved = createMcpManagementTools(agent.id, {
      approval: { ...resumeData, approved: true },
      suspend,
    })

    await approved.execute(call('InstallPlugin', args))
    const replay = await approved.execute(call('InstallPlugin', args))

    expect(replay).toContain('Waiting for the user')
    expect(suspend).toHaveBeenCalledOnce()
  })
})
