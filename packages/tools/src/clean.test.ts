import { existsSync, mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'

process.env.OPENBOT_DATA_DIR = mkdtempSync(
  path.join(os.tmpdir(), 'openbot-tools-test-'),
)

type DbModule = typeof import('@openbot/db')
type SchemaModule = typeof import('@openbot/db/schema')
type CleanModule = typeof import('./clean')

let database: DbModule
let schema: SchemaModule
let cleaner: CleanModule

beforeAll(async () => {
  database = await import('@openbot/db')
  schema = await import('@openbot/db/schema')
  cleaner = await import('./clean')
})

beforeEach(async () => {
  await cleaner.cleanData(new Set(cleaner.cleanTargets))
  await database.db.delete(schema.groups)
})

describe('cleanData', () => {
  it('deletes bots, their conversations, and group memberships', async () => {
    const { agent } = await database.createAgent({ name: 'Disposable bot' })
    await database.db.insert(schema.groups).values({
      id: 'grp_test',
      name: 'Test group',
      membersJson: {
        version: 1,
        members: [{ type: 'agent', agentId: agent.id }],
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    await database.db.insert(schema.conversations).values({
      id: 'cnv_group_test',
      ownerGroupId: 'grp_test',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    await database.db.insert(schema.turns).values({
      id: 'trn_group_bot',
      conversationId: 'cnv_group_test',
      targetAgentId: agent.id,
      lane: 'agent',
      source: 'group',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    await database.db.insert(schema.conversationMessages).values({
      id: 'msg_group_bot',
      conversationId: 'cnv_group_test',
      turnId: 'trn_group_bot',
      sequenceNo: 1,
      kind: 'message',
      direction: 'internal',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })

    const avatar = await database.createManagedFile({
      bytes: new Uint8Array([1, 2, 3]),
      originalName: 'avatar.png',
      mediaType: 'image/png',
      subdirectory: 'avatars',
    })
    await database.db
      .update(schema.agents)
      .set({ avatarFileId: avatar.id })
    const avatarPath = database.resolveManagedFilePath(avatar.relativePath)

    const result = await cleaner.cleanData(new Set(['bots']))

    expect(result).toEqual({ bots: 1 })
    expect(await database.listAgents()).toEqual([])
    expect(await database.listConversations()).toHaveLength(1)
    const [group] = await database.db.select().from(schema.groups)
    expect(group.membersJson.members).toEqual([])
    const [message] = await database.db
      .select()
      .from(schema.conversationMessages)
    expect(message.turnId).toBeNull()
    expect(await database.getManagedFile(avatar.id)).toBeUndefined()
    expect(existsSync(avatarPath)).toBe(false)
  })

  it('deletes conversations without deleting bots and refreshes group conversations', async () => {
    await database.createAgent({ name: 'Persistent bot' })
    await database.db.insert(schema.groups).values({
      id: 'grp_persistent',
      name: 'Persistent group',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    await database.db.insert(schema.conversations).values({
      id: 'cnv_old_group',
      ownerGroupId: 'grp_persistent',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })

    const result = await cleaner.cleanData(new Set(['conversations']))

    expect(result).toEqual({ conversations: 2 })
    expect(await database.listAgents()).toHaveLength(1)
    const remaining = await database.listConversations()
    expect(remaining).toHaveLength(1)
    expect(remaining[0].ownerGroupId).toBe('grp_persistent')
    expect(remaining[0].id).not.toBe('cnv_old_group')
  })

  it('deletes MCP servers and their dependent accounts and access', async () => {
    const { agent } = await database.createAgent({ name: 'MCP bot' })
    await database.db.insert(schema.mcpServers).values({
      id: 'mcp_test',
      serverKey: 'test',
      name: 'Test MCP',
      transport: 'stdio',
      configurationJson: { version: 1 },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    await database.db.insert(schema.mcpAccounts).values({
      id: 'mca_test',
      serverId: 'mcp_test',
      label: 'default',
      authType: 'api_key',
      credentialsJson: { version: 1, apiKey: 'secret' },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    await database.db.insert(schema.agentMcpAccounts).values({
      agentId: agent.id,
      accountId: 'mca_test',
      enabledAt: Date.now(),
    })

    const result = await cleaner.cleanData(new Set(['mcps']))

    expect(result).toEqual({ mcps: 1 })
    expect(await database.db.select().from(schema.mcpServers)).toEqual([])
    expect(await database.db.select().from(schema.mcpAccounts)).toEqual([])
    expect(await database.db.select().from(schema.agentMcpAccounts)).toEqual([])
    expect(await database.listAgents()).toHaveLength(1)
  })
})
