import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { ModelToolCall, WaitingState } from '@openbot/db'
import { describe, expect, it, vi } from 'vitest'
import type { PluginApproval } from './management'

process.env.OPENBOT_DATA_DIR ??= mkdtempSync(path.join(tmpdir(), 'openbot-management-tests-'))

const { createAgent, createMcpApiKeyAccount, listAgentMcpAccounts } = await import('@openbot/db')
const { applyApprovedPlugin, createMcpManagementTools } = await import('./management')
const { installCatalogServer } = await import('./handlers')

type ApprovalData = Omit<PluginApproval, 'approved'>

function call(name: string, args: Record<string, unknown>): ModelToolCall {
  return {
    id: 'management-call',
    type: 'function',
    function: { name, arguments: JSON.stringify(args) },
  }
}

describe('MCP management tools', () => {
  it('searches aliases across the full catalog and reports agent access separately', async () => {
    const tools = createMcpManagementTools('unused-agent', { suspend: vi.fn() })
    const result = await tools.execute(call('SearchPlugins', { query: 'issue tracker' }))

    expect(tools.definitions.map((definition) => definition.function.name)).toEqual([
      'SearchPlugins',
      'GetPlugin',
      'InstallPlugin',
    ])
    expect(result).toContain('linear: Linear')
    expect(result).toContain('clickup: ClickUp')
    expect(result).toContain('server installed=')
    expect(result).toContain('granted to this agent=0')
  })

  it('requires durable approval and rejects invalid account selections', async () => {
    let waiting: WaitingState | undefined
    const suspend = vi.fn(async (state: WaitingState) => { waiting = state })
    const tools = createMcpManagementTools('unused-agent', { suspend })
    const rejected = await tools.execute(call('InstallPlugin', {
      plugin_id: 'linear',
      account_ids: 'not-a-list',
    }))
    expect(rejected).toContain('account_ids must be an array')
    expect(suspend).not.toHaveBeenCalled()

    const args = { plugin_id: 'linear' }
    const result = await tools.execute(call('InstallPlugin', args))

    expect(result).toContain('Waiting for the user')
    expect(waiting?.originatingToolCall.name).toBe('InstallPlugin')
    expect(waiting?.resumeData).toEqual(expect.objectContaining({
      pluginId: 'linear',
      valuesHash: expect.any(String),
      accountIds: expect.any(Array),
    }))
    expect(waiting?.options.find((option) => option.id === 'approve')?.label).toBe(
      'Install Linear',
    )
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
      account_ids: [account.id],
    }
    const first = createMcpManagementTools(agent.id, {
      suspend: async (state) => { waiting = state },
    })
    await first.execute(call('InstallPlugin', args))
    const resumeData = waiting!.resumeData as ApprovalData
    const approved = createMcpManagementTools(agent.id, {
      approval: { ...resumeData, approved: true },
      suspend: vi.fn(),
    })
    const result = await approved.execute(call('InstallPlugin', args))

    expect(result).toContain('Enabled Linear (plugin linear) for this agent.')
    expect(result).toContain('The connector account was granted.')
    expect(await listAgentMcpAccounts(agent.id)).toEqual([
      expect.objectContaining({ label: 'Approved Work' }),
    ])
  })

  it('rejects a mismatched account before requesting approval', async () => {
    const suspend = vi.fn()
    const tools = createMcpManagementTools('unused-agent', { suspend })

    const result = await tools.execute(call('InstallPlugin', {
      plugin_id: 'linear',
      account_ids: ['account-from-another-plugin'],
    }))

    expect(result).toContain('does not belong to Linear')
    expect(suspend).not.toHaveBeenCalled()
  })

  it('automatically selects the sole active account', async () => {
    const { agent } = await createAgent({ name: 'Sole account test' })
    const server = await installCatalogServer({ key: 'clickup' })
    const account = await createMcpApiKeyAccount({
      serverId: server.id,
      label: 'Only account',
      apiKey: 'only-account-key',
    })
    let waiting: WaitingState | undefined
    const args = { plugin_id: 'clickup' }
    const initial = createMcpManagementTools(agent.id, {
      suspend: async (state) => { waiting = state },
    })
    await initial.execute(call('InstallPlugin', args))

    expect(waiting?.prompt).toContain('"Only account" account')
    expect(waiting?.options.find((option) => option.id === 'approve')?.label).toBe(
      'Enable ClickUp',
    )
    const resumeData = waiting!.resumeData as ApprovalData
    await applyApprovedPlugin(agent.id, { ...resumeData, approved: true })
    expect(await listAgentMcpAccounts(agent.id)).toEqual([
      expect.objectContaining({ id: account.id }),
    ])
    const details = await initial.execute(call('GetPlugin', { plugin_id: 'clickup' }))
    expect(details).toContain('connected accounts=1 · granted to this agent=1')
    expect(details).toContain('agent access=granted')
  })

  it('requires a selection when multiple active accounts exist and accepts several', async () => {
    const { agent } = await createAgent({ name: 'Multiple account test' })
    const server = await installCatalogServer({ key: 'notion' })
    const firstAccount = await createMcpApiKeyAccount({
      serverId: server.id,
      label: 'Work',
      apiKey: 'work-key',
    })
    const secondAccount = await createMcpApiKeyAccount({
      serverId: server.id,
      label: 'Personal',
      apiKey: 'personal-key',
    })
    const suspend = vi.fn()
    const tools = createMcpManagementTools(agent.id, { suspend })

    const required = await tools.execute(call('InstallPlugin', { plugin_id: 'notion' }))
    expect(required).toContain('multiple active accounts')
    expect(required).toContain(firstAccount.id)
    expect(required).toContain(secondAccount.id)
    expect(suspend).not.toHaveBeenCalled()

    const args = {
      plugin_id: 'notion',
      account_ids: [firstAccount.id, secondAccount.id],
    }
    await tools.execute(call('InstallPlugin', args))
    expect(suspend).toHaveBeenCalledOnce()

    const waiting = suspend.mock.calls[0]![0] as WaitingState
    const resumeData = waiting.resumeData as ApprovalData
    const approved = createMcpManagementTools(agent.id, {
      approval: { ...resumeData, approved: true },
      suspend: vi.fn(),
    })
    await approved.execute(call('InstallPlugin', args))
    expect(
      (await listAgentMcpAccounts(agent.id)).map((account) => account.id).sort(),
    ).toEqual([firstAccount.id, secondAccount.id].sort())
  })

  it('consumes a matching approval after one install attempt', async () => {
    const { agent } = await createAgent({ name: 'One-shot approval test' })
    let waiting: WaitingState | undefined
    const args = { plugin_id: 'linear' }
    const initial = createMcpManagementTools(agent.id, {
      suspend: async (state) => { waiting = state },
    })
    await initial.execute(call('InstallPlugin', args))
    const resumeData = waiting!.resumeData as ApprovalData
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
