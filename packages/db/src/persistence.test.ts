import { existsSync, mkdtempSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'

// A fresh temporary data directory must be configured before the package is
// imported: opening the database, enabling foreign keys, requesting WAL, and
// applying migrations all happen on import (the public startup path).
const dataDirectory = mkdtempSync(path.join(os.tmpdir(), 'openbot-db-test-'))
process.env.OPENBOT_DATA_DIR = dataDirectory

type DbModule = typeof import('./index')

let dbModule: DbModule

beforeAll(async () => {
  dbModule = await import('./index')
})

function pngBytes(fill: number) {
  return new Uint8Array([0x89, 0x50, 0x4e, 0x47, fill, fill, fill])
}

describe('agent profiles', () => {
  it('creates, lists, gets, and updates an agent profile', async () => {
    const { agent: created, conversation } = await dbModule.createAgent({
      name: 'Ops Watch',
      description: 'Watches error rates overnight.',
    })
    expect(created.id).toMatch(/^agt_/)
    expect(created.avatarShape).toBe('squircle')
    expect(created.avatarColor).toBe('#5865c4')
    expect(created.notifyOnUpdates).toBe(true)
    expect(created.hiddenFromSidebar).toBe(false)

    // A first conversation named after the agent is created transactionally.
    expect(conversation.id).toMatch(/^cnv_/)
    expect(conversation.ownerAgentId).toBe(created.id)
    expect(conversation.title).toBe('Ops Watch')
    const listedConversations = await dbModule.listConversations()
    expect(listedConversations.map((c) => c.id)).toContain(conversation.id)

    const listed = await dbModule.listAgents()
    expect(listed.map((agent) => agent.id)).toContain(created.id)

    const fetched = await dbModule.getAgent(created.id)
    expect(fetched?.name).toBe('Ops Watch')

    const updated = await dbModule.updateAgentProfile(created.id, {
      name: 'Ops Watch 2',
      description: 'Updated description',
      avatarShape: 'hexagon',
      avatarColor: '#b3536e',
      defaultModel: 'claude-sonnet-5',
      notifyOnUpdates: false,
      hiddenFromSidebar: true,
    })
    expect(updated?.name).toBe('Ops Watch 2')
    expect(updated?.avatarShape).toBe('hexagon')
    expect(updated?.avatarColor).toBe('#b3536e')
    expect(updated?.defaultModel).toBe('claude-sonnet-5')
    expect(updated?.notifyOnUpdates).toBe(false)
    expect(updated?.hiddenFromSidebar).toBe(true)
    expect(updated?.updatedAt).toBeGreaterThanOrEqual(created.updatedAt)
  })

  it('keeps profiles across a server restart', async () => {
    const { agent: created, conversation } = await dbModule.createAgent({
      name: 'Restart Survivor',
      description: 'Should outlive the process state.',
      defaultModel: 'claude-opus-5',
      notifyOnUpdates: false,
      hiddenFromSidebar: true,
    })

    // Re-import the package with a cleared module registry: a fresh client is
    // opened against the same data directory, re-running the startup path.
    vi.resetModules()
    const reloaded: DbModule = await import('./index')

    const survivor = await reloaded.getAgent(created.id)
    expect(survivor?.name).toBe('Restart Survivor')
    expect(survivor?.description).toBe('Should outlive the process state.')
    expect(survivor?.defaultModel).toBe('claude-opus-5')
    expect(survivor?.notifyOnUpdates).toBe(false)
    expect(survivor?.hiddenFromSidebar).toBe(true)

    const conversations = await reloaded.listConversations()
    expect(conversations.map((c) => c.id)).toContain(conversation.id)
  })
})

describe('conversations', () => {
  it('creates and deletes a conversation for an agent', async () => {
    const { agent } = await dbModule.createAgent({ name: 'Convo Owner' })

    const created = await dbModule.createConversation({
      ownerAgentId: agent.id,
      title: 'Side project',
    })
    expect(created.ownerAgentId).toBe(agent.id)
    expect(created.title).toBe('Side project')

    expect(await dbModule.deleteConversation(created.id)).toBe(true)
    expect(await dbModule.deleteConversation(created.id)).toBe(false)
    const remaining = await dbModule.listConversations()
    expect(remaining.map((c) => c.id)).not.toContain(created.id)
  })

  it('rejects a conversation for a missing agent', async () => {
    await expect(
      dbModule.createConversation({ ownerAgentId: 'agt_missing' }),
    ).rejects.toThrow()
  })
})

describe('conversation navigation', () => {
  it('persists title, plan, origin, and purpose across a restart', async () => {
    const { agent } = await dbModule.createAgent({ name: 'Nav Agent' })
    const created = await dbModule.createConversation({
      ownerAgentId: agent.id,
      title: 'Initial title',
      origin: 'user',
      purpose: 'Track the persistence work',
    })
    expect(created.origin).toBe('user')
    expect(created.purpose).toBe('Track the persistence work')

    const updated = await dbModule.updateConversation(created.id, {
      title: 'Renamed title',
      currentPlanUri: 'plan://nav-agent/1',
    })
    expect(updated?.title).toBe('Renamed title')
    expect(updated?.currentPlanUri).toBe('plan://nav-agent/1')
    expect(updated?.updatedAt).toBeGreaterThanOrEqual(created.updatedAt)

    vi.resetModules()
    const reloaded: DbModule = await import('./index')
    const survivor = await reloaded.getConversation(created.id)
    expect(survivor?.title).toBe('Renamed title')
    expect(survivor?.currentPlanUri).toBe('plan://nav-agent/1')
    expect(survivor?.origin).toBe('user')
    expect(survivor?.purpose).toBe('Track the persistence work')
  })

  it('marks a conversation unread and read', async () => {
    const { agent } = await dbModule.createAgent({ name: 'Unread Agent' })
    const created = await dbModule.createConversation({ ownerAgentId: agent.id })
    expect(created.manuallyUnread).toBe(false)
    expect(created.lastReadSequenceNo).toBe(0)

    const unread = await dbModule.markConversationUnread(created.id)
    expect(unread?.manuallyUnread).toBe(true)

    // New transcript activity moves the read horizon forward.
    await dbModule.allocateConversationSequence(created.id)
    await dbModule.allocateConversationSequence(created.id)

    const read = await dbModule.markConversationRead(created.id)
    expect(read?.manuallyUnread).toBe(false)
    // Everything allocated so far is now read: last read = next - 1.
    expect(read?.lastReadSequenceNo).toBe(read!.nextSequenceNo - 1)
  })

  it('allocates sequence numbers atomically without duplicates', async () => {
    const { agent } = await dbModule.createAgent({ name: 'Sequence Agent' })
    const created = await dbModule.createConversation({ ownerAgentId: agent.id })

    const allocated = await Promise.all(
      Array.from({ length: 25 }, () =>
        dbModule.allocateConversationSequence(created.id),
      ),
    )
    expect(new Set(allocated).size).toBe(25)
    expect(Math.min(...allocated)).toBe(1)
    expect(Math.max(...allocated)).toBe(25)

    const after = await dbModule.getConversation(created.id)
    expect(after?.nextSequenceNo).toBe(26)
  })

  it('clears a conversation into a fresh one and removes dependent state', async () => {
    const { agent } = await dbModule.createAgent({ name: 'Clear Agent' })
    const created = await dbModule.createConversation({
      ownerAgentId: agent.id,
      title: 'Busy room',
      origin: 'user',
      purpose: 'Long-running work',
    })

    const sequenceNo = await dbModule.allocateConversationSequence(created.id)
    const now = Date.now()
    await dbModule.db.insert(dbModule.conversationMessages).values({
      id: 'msg_clear_test',
      conversationId: created.id,
      sequenceNo,
      kind: 'message',
      role: 'user',
      direction: 'inbound',
      bodyText: 'hello',
      createdAt: now,
      updatedAt: now,
    })

    const fresh = await dbModule.clearConversation(created.id)
    expect(fresh.id).not.toBe(created.id)
    expect(fresh.ownerAgentId).toBe(agent.id)
    expect(fresh.title).toBe('Busy room')
    expect(fresh.origin).toBe('user')
    expect(fresh.purpose).toBe('Long-running work')
    expect(fresh.nextSequenceNo).toBe(1)
    expect(fresh.currentPlanUri).toBeNull()

    expect(await dbModule.getConversation(created.id)).toBeUndefined()
    const orphanedMessages = await dbModule.db
      .select()
      .from(dbModule.conversationMessages)
      .where(eq(dbModule.conversationMessages.conversationId, created.id))
    expect(orphanedMessages).toHaveLength(0)

    await expect(dbModule.clearConversation(created.id)).rejects.toThrow(/not found/)
  })
})

describe('conversation transcript', () => {
  it('appends and lists transcript rows in conversation order', async () => {
    const { agent } = await dbModule.createAgent({ name: 'Transcript Agent' })
    const conversation = await dbModule.createConversation({ ownerAgentId: agent.id })

    const first = await dbModule.appendConversationMessage({
      conversationId: conversation.id,
      kind: 'message',
      role: 'user',
      direction: 'inbound',
      bodyText: 'first',
    })
    const second = await dbModule.appendConversationMessage({
      conversationId: conversation.id,
      kind: 'status',
      direction: 'internal',
      bodyText: 'thinking',
    })
    const third = await dbModule.appendConversationMessage({
      conversationId: conversation.id,
      kind: 'message',
      role: 'assistant',
      direction: 'outbound',
      bodyText: 'second',
    })

    expect(first.sequenceNo).toBeLessThan(second.sequenceNo)
    expect(second.sequenceNo).toBeLessThan(third.sequenceNo)

    const listed = await dbModule.listConversationMessages(conversation.id)
    expect(listed.map((m) => m.id)).toEqual([first.id, second.id, third.id])
    expect(listed.map((m) => m.kind)).toEqual(['message', 'status', 'message'])
  })

  it('accepts a user message atomically with its queued turn', async () => {
    const { agent } = await dbModule.createAgent({ name: 'Send Agent' })
    const conversation = await dbModule.createConversation({ ownerAgentId: agent.id })

    const { message, turn } = await dbModule.acceptUserMessage({
      conversationId: conversation.id,
      text: 'hello there',
    })

    expect(message.id).toMatch(/^ent_/)
    expect(message.kind).toBe('message')
    expect(message.role).toBe('user')
    expect(message.bodyText).toBe('hello there')
    expect(message.turnId).toBe(turn.id)

    expect(turn.id).toMatch(/^trn_/)
    expect(turn.conversationId).toBe(conversation.id)
    expect(turn.targetAgentId).toBe(agent.id)
    expect(turn.lane).toBe('user')
    expect(turn.status).toBe('queued')

    await expect(
      dbModule.acceptUserMessage({ conversationId: 'cnv_missing', text: 'nope' }),
    ).rejects.toThrow(/not found/)
  })
})

describe('turns', () => {
  it('claims a queued turn exactly once and completes it', async () => {
    const { agent } = await dbModule.createAgent({ name: 'Turn Agent' })
    const conversation = await dbModule.createConversation({ ownerAgentId: agent.id })
    const { turn } = await dbModule.acceptUserMessage({
      conversationId: conversation.id,
      text: 'do work',
    })

    const next = await dbModule.findNextQueuedTurn(conversation.id)
    expect(next?.id).toBe(turn.id)

    const claimed = await dbModule.claimQueuedTurn(turn.id)
    expect(claimed?.status).toBe('running')
    expect(claimed?.attemptCount).toBe(1)
    expect(claimed?.startedAt).not.toBeNull()

    // Claiming is atomic: a second claim of the same turn yields nothing.
    expect(await dbModule.claimQueuedTurn(turn.id)).toBeUndefined()
    expect(await dbModule.findNextQueuedTurn(conversation.id)).toBeUndefined()

    const snapshotted = await dbModule.recordTurnExecution(turn.id, {
      modelProvider: 'openai-compatible',
      modelId: 'test-model',
      effectiveTools: { version: 1, tools: [] },
      effectivePermissions: { version: 1, approvalMode: agent.approvalMode },
      runtimeContext: { version: 1, baseUrl: 'https://example.test/v1' },
    })
    expect(snapshotted?.modelId).toBe('test-model')
    expect(snapshotted?.effectiveToolsJson).toEqual({ version: 1, tools: [] })
    expect(snapshotted?.effectivePermissionsJson).toMatchObject({
      approvalMode: agent.approvalMode,
    })
    expect(snapshotted?.runtimeContextJson).toMatchObject({
      baseUrl: 'https://example.test/v1',
    })

    const done = await dbModule.completeTurn(turn.id, { status: 'succeeded' })
    expect(done?.status).toBe('succeeded')
    expect(done?.completedAt).not.toBeNull()
  })

  it('records failure details when a turn fails', async () => {
    const { agent } = await dbModule.createAgent({ name: 'Failing Turn Agent' })
    const conversation = await dbModule.createConversation({ ownerAgentId: agent.id })
    const { turn } = await dbModule.acceptUserMessage({
      conversationId: conversation.id,
      text: 'break',
    })

    await dbModule.claimQueuedTurn(turn.id)
    const failed = await dbModule.completeTurn(turn.id, {
      status: 'failed',
      error: { version: 1, message: 'provider unavailable' },
    })
    expect(failed?.status).toBe('failed')
    expect(failed?.errorJson).toMatchObject({ message: 'provider unavailable' })
  })

  it('resets interrupted running turns to queued after a restart', async () => {
    const { agent } = await dbModule.createAgent({ name: 'Crash Agent' })
    const conversation = await dbModule.createConversation({ ownerAgentId: agent.id })
    const { turn } = await dbModule.acceptUserMessage({
      conversationId: conversation.id,
      text: 'crash mid-flight',
    })
    const claimed = await dbModule.claimQueuedTurn(turn.id)
    expect(claimed?.status).toBe('running')

    vi.resetModules()
    const reloaded: DbModule = await import('./index')

    const recovered = await reloaded.getTurn(turn.id)
    expect(recovered?.status).toBe('queued')
    expect(recovered?.attemptCount).toBe(2)
    expect(recovered?.startedAt).toBeNull()
    expect(await reloaded.findNextQueuedTurn(conversation.id)).toMatchObject({
      id: turn.id,
    })
  })
})

describe('conversation checkpoints', () => {
  it('creates immutable versioned checkpoints and advances the pointer', async () => {
    const { agent } = await dbModule.createAgent({ name: 'Checkpoint Agent' })
    const conversation = await dbModule.createConversation({ ownerAgentId: agent.id })

    const first = await dbModule.createConversationCheckpoint(conversation.id, {
      version: 1,
      modelMessages: [
        { role: 'system', content: 'You are Checkpoint Agent.' },
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'hi' },
      ],
    })
    expect(first.id).toMatch(/^chk_/)
    expect(first.schemaVersion).toBe(1)
    expect(first.parentCheckpointId).toBeNull()
    expect(first.contentHash).toMatch(/^[0-9a-f]{64}$/)
    expect(first.byteSize).toBeGreaterThan(0)

    const afterFirst = await dbModule.getConversation(conversation.id)
    expect(afterFirst?.currentCheckpointId).toBe(first.id)

    const second = await dbModule.createConversationCheckpoint(conversation.id, {
      version: 1,
      modelMessages: [
        { role: 'system', content: 'You are Checkpoint Agent.' },
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'hi' },
        { role: 'user', content: 'more' },
        { role: 'assistant', content: 'sure' },
      ],
    })
    expect(second.parentCheckpointId).toBe(first.id)

    const afterSecond = await dbModule.getConversation(conversation.id)
    expect(afterSecond?.currentCheckpointId).toBe(second.id)

    // The first checkpoint is untouched by later checkpoint creation.
    const current = await dbModule.getCurrentCheckpoint(conversation.id)
    expect(current?.id).toBe(second.id)
    expect(dbModule.checkpointStateSchema.parse(current?.stateJson).modelMessages)
      .toHaveLength(5)
  })

  it('restores checkpoint state across a restart', async () => {
    const { agent } = await dbModule.createAgent({ name: 'Resume Agent' })
    const conversation = await dbModule.createConversation({ ownerAgentId: agent.id })
    const checkpoint = await dbModule.createConversationCheckpoint(conversation.id, {
      version: 1,
      modelMessages: [{ role: 'user', content: 'remember me' }],
    })

    vi.resetModules()
    const reloaded: DbModule = await import('./index')

    const current = await reloaded.getCurrentCheckpoint(conversation.id)
    expect(current?.id).toBe(checkpoint.id)
    const state = reloaded.checkpointStateSchema.parse(current?.stateJson)
    expect(state.modelMessages).toEqual([{ role: 'user', content: 'remember me' }])
  })

  it('rejects a checkpoint for a missing conversation', async () => {
    await expect(
      dbModule.createConversationCheckpoint('cnv_missing', {
        version: 1,
        modelMessages: [],
      }),
    ).rejects.toThrow(/not found/)
  })
})

describe('agent avatars and managed files', () => {
  it('uploads, serves, replaces, and removes an avatar', async () => {
    const { agent } = await dbModule.createAgent({ name: 'Avatar Agent' })

    const withAvatar = await dbModule.setAgentAvatar(agent.id, {
      bytes: pngBytes(1),
      originalName: 'first.png',
      mediaType: 'image/png',
    })
    expect(withAvatar.avatarFileId).toMatch(/^fil_/)

    const served = await dbModule.getAgentAvatarFile(agent.id)
    expect(served).toBeDefined()
    expect(served?.file.mediaType).toBe('image/png')
    expect(served?.file.relativePath.startsWith('avatars/')).toBe(true)
    expect(Buffer.from(served!.bytes)).toEqual(Buffer.from(pngBytes(1)))

    const firstFileId = withAvatar.avatarFileId!
    const firstPath = dbModule.resolveManagedFilePath(served!.file.relativePath)
    expect(existsSync(firstPath)).toBe(true)

    const replaced = await dbModule.setAgentAvatar(agent.id, {
      bytes: pngBytes(2),
      originalName: 'second.png',
      mediaType: 'image/png',
    })
    expect(replaced.avatarFileId).not.toBe(firstFileId)
    expect(await dbModule.getManagedFile(firstFileId)).toBeUndefined()
    expect(existsSync(firstPath)).toBe(false)

    const secondFileId = replaced.avatarFileId!
    const secondFile = await dbModule.getManagedFile(secondFileId)
    const secondPath = dbModule.resolveManagedFilePath(secondFile!.relativePath)

    const removed = await dbModule.removeAgentAvatar(agent.id)
    expect(removed.avatarFileId).toBeNull()
    expect(await dbModule.getManagedFile(secondFileId)).toBeUndefined()
    expect(existsSync(secondPath)).toBe(false)
    expect(await dbModule.getAgentAvatarFile(agent.id)).toBeUndefined()
  })

  it('does not delete a managed file that is still referenced elsewhere', async () => {
    const { agent: owner } = await dbModule.createAgent({ name: 'Shared Avatar Owner' })
    const { agent: other } = await dbModule.createAgent({ name: 'Shared Avatar Borrower' })

    const withAvatar = await dbModule.setAgentAvatar(owner.id, {
      bytes: pngBytes(3),
      originalName: 'shared.png',
      mediaType: 'image/png',
    })
    const sharedFileId = withAvatar.avatarFileId!

    // One managed file may be referenced by multiple avatars; point a second
    // agent at the same file to simulate that.
    await dbModule.db
      .update(dbModule.agents)
      .set({ avatarFileId: sharedFileId })
      .where(eq(dbModule.agents.id, other.id))

    await dbModule.removeAgentAvatar(owner.id)
    const sharedFile = await dbModule.getManagedFile(sharedFileId)
    expect(sharedFile).toBeDefined()
    expect(existsSync(dbModule.resolveManagedFilePath(sharedFile!.relativePath))).toBe(
      true,
    )

    // Once the last reference is gone the file is deleted.
    await dbModule.removeAgentAvatar(other.id)
    expect(await dbModule.getManagedFile(sharedFileId)).toBeUndefined()
  })

  it('rejects managed paths that escape the data directory', () => {
    expect(() => dbModule.resolveManagedFilePath('../escape.txt')).toThrow()
    expect(() => dbModule.resolveManagedFilePath('avatars/../../escape.txt')).toThrow()
    expect(() => dbModule.resolveManagedFilePath('/etc/passwd')).toThrow()
    expect(() => dbModule.resolveManagedFilePath('')).toThrow()

    const resolved = dbModule.resolveManagedFilePath('avatars/fil_ok.png')
    expect(resolved.startsWith(path.join(dataDirectory, 'files'))).toBe(true)
  })

  it('rejects unsupported avatar uploads', async () => {
    const { agent } = await dbModule.createAgent({ name: 'Picky Agent' })

    await expect(
      dbModule.setAgentAvatar(agent.id, {
        bytes: pngBytes(4),
        originalName: 'evil.svg',
        mediaType: 'image/svg+xml',
      }),
    ).rejects.toThrow(/media type/)

    await expect(
      dbModule.setAgentAvatar(agent.id, {
        bytes: new Uint8Array(0),
        originalName: 'empty.png',
        mediaType: 'image/png',
      }),
    ).rejects.toThrow(/empty/)

    await expect(
      dbModule.setAgentAvatar(agent.id, {
        bytes: new Uint8Array(dbModule.MAX_AVATAR_BYTES + 1),
        originalName: 'huge.png',
        mediaType: 'image/png',
      }),
    ).rejects.toThrow(/maximum size/)
  })

  it('reads managed file bytes only through validated relative paths', async () => {
    const { agent } = await dbModule.createAgent({ name: 'Escape Artist' })
    await dbModule.setAgentAvatar(agent.id, {
      bytes: pngBytes(5),
      originalName: 'fine.png',
      mediaType: 'image/png',
    })
    const served = await dbModule.getAgentAvatarFile(agent.id)
    const onDisk = await readFile(
      dbModule.resolveManagedFilePath(served!.file.relativePath),
    )
    expect(Buffer.from(onDisk)).toEqual(Buffer.from(pngBytes(5)))

    // A row whose stored path escapes the managed directory must be refused.
    await dbModule.db.insert(dbModule.managedFiles).values({
      id: 'fil_escape_test',
      relativePath: '../escape-row.txt',
      originalName: 'escape-row.txt',
      mediaType: 'text/plain',
      byteSize: 1,
      createdAt: Date.now(),
    })
    await expect(dbModule.readManagedFile('fil_escape_test')).rejects.toThrow(
      /escapes/,
    )
  })
})
