import assert from 'node:assert/strict'
import { access, mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'

const testData = path.resolve(process.cwd(), '../../.data', `agent-deletion-tests-${process.pid}`)
await rm(testData, { recursive: true, force: true })
process.env.OPENBOT_DATA_DIR = testData

const db = await import('./index')

test('deletes an agent, cascades owned data, and cleans external records', async () => {
  const target = await db.createAgent({ name: 'Delete me' })
  const survivor = await db.createAgent({ name: 'Keep me' })
  const extraConversation = await db.createConversation({
    ownerAgentId: target.agent.id,
    title: 'Extra room',
  })
  const group = await db.createGroup({
    name: 'Mixed group',
    members: [
      { type: 'agent', agentId: target.agent.id },
      { type: 'agent', agentId: survivor.agent.id },
    ],
  })
  const accepted = await db.acceptUserMessage({
    conversationId: target.conversation.id,
    text: 'This history should cascade',
  })
  await db.appendConversationMessage({
    conversationId: extraConversation.id,
    kind: 'message',
    role: 'user',
    direction: 'inbound',
    bodyText: 'More history',
  })
  const attachment = await db.createManagedFile({
    bytes: new Uint8Array([4, 5, 6]),
    originalName: 'result.png',
    mediaType: 'image/png',
    subdirectory: 'browser/test',
  })
  const attachmentPath = db.resolveManagedFilePath(attachment.relativePath)
  await db.appendConversationMessage({
    conversationId: extraConversation.id,
    kind: 'tool_result',
    role: 'tool',
    direction: 'outbound',
    bodyText: 'Browser result',
    attachments: {
      version: 1,
      items: [{ fileId: attachment.id, position: 0, metadata: {} }],
    },
  })

  const server = await db.createMcpServer({
    serverKey: `delete-test-${process.pid}`,
    name: 'Deletion test MCP',
    transport: 'streamable_http',
    configuration: { version: 1, url: 'https://example.com/mcp' },
  })
  const account = await db.createMcpApiKeyAccount({
    serverId: server.id,
    label: 'Deletion test account',
    apiKey: 'secret',
  })
  await db.setAgentMcpAccounts(target.agent.id, [account.id])

  const avatarAgent = await db.setAgentAvatar(target.agent.id, {
    bytes: new Uint8Array([1, 2, 3]),
    originalName: 'avatar.png',
    mediaType: 'image/png',
  })
  assert.ok(avatarAgent.avatarFileId)
  const avatar = await db.getManagedFile(avatarAgent.avatarFileId)
  assert.ok(avatar)
  const avatarPath = db.resolveManagedFilePath(avatar.relativePath)

  const conversationIds = [target.conversation.id, extraConversation.id]
  for (const conversationId of conversationIds) {
    const session = await db.piSessionDirectory(conversationId)
    await mkdir(session, { recursive: true })
    await writeFile(path.join(session, 'history.jsonl'), '{}')
  }

  assert.equal(await db.deleteAgent(target.agent.id), true)
  assert.equal(await db.getAgent(target.agent.id), undefined)
  assert.deepEqual(
    (await db.getGroup(group.group.id))?.membersJson,
    { version: 1, members: [{ type: 'agent', agentId: survivor.agent.id }] },
  )
  assert.equal(await db.getTurn(accepted.turn.id), undefined)
  assert.deepEqual(await db.listAgentMcpAccounts(target.agent.id), [])
  for (const conversationId of conversationIds) {
    assert.equal(await db.getConversation(conversationId), undefined)
    assert.deepEqual(await db.listConversationMessages(conversationId), [])
    await assert.rejects(access(path.join(testData, 'pi-sessions', conversationId)))
  }
  assert.equal(await db.getManagedFile(avatarAgent.avatarFileId), undefined)
  await assert.rejects(access(avatarPath))
  assert.equal(await db.getManagedFile(attachment.id), undefined)
  await assert.rejects(access(attachmentPath))
  assert.deepEqual(await db.getAgent(survivor.agent.id), survivor.agent)
})

test('preserves group history while removing an agent-targeted turn', async () => {
  const target = await db.createAgent({ name: 'Former group member' })
  const group = await db.createGroup({
    name: 'Persistent group',
    members: [{ type: 'agent', agentId: target.agent.id }],
  })
  const now = Date.now()
  const turnId = db.createId('trn')
  await db.db.insert(db.turns).values({
    id: turnId,
    conversationId: group.conversation.id,
    targetAgentId: target.agent.id,
    lane: 'agent',
    source: 'group',
    createdAt: now,
    updatedAt: now,
  })
  const message = await db.appendConversationMessage({
    conversationId: group.conversation.id,
    turnId,
    kind: 'message',
    role: 'assistant',
    direction: 'outbound',
    senderAgentId: target.agent.id,
    bodyText: 'Keep this group history',
  })

  assert.equal(await db.deleteAgent(target.agent.id), true)
  assert.equal(await db.getTurn(turnId), undefined)
  assert.equal((await db.listConversationMessages(group.conversation.id))[0]?.id, message.id)
  assert.equal((await db.listConversationMessages(group.conversation.id))[0]?.turnId, null)
  assert.equal((await db.listConversationMessages(group.conversation.id))[0]?.senderAgentId, null)
})

test('returns false when the agent does not exist', async () => {
  assert.equal(await db.deleteAgent(`agt_${'x'.repeat(22)}`), false)
})
