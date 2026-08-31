import { mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'

const dataDirectory = mkdtempSync(path.join(os.tmpdir(), 'openbot-memory-test-'))
process.env.OPENBOT_DATA_DIR = dataDirectory

type DbModule = typeof import('./index')

let dbModule: DbModule

beforeAll(async () => {
  dbModule = await import('./index')
})

describe('durable memory', () => {
  it('creates, scopes, updates, inspects, and immediately forgets memory', async () => {
    const { agent: author } = await dbModule.createAgent({ name: 'Memory Author' })
    const { agent: alpha } = await dbModule.createAgent({ name: 'Alpha' })
    const { agent: beta } = await dbModule.createAgent({ name: 'Beta' })

    const shared = await dbModule.createMemoryItem({
      scope: 'user',
      kind: 'profile',
      content: 'The user prefers concise updates.',
      authoredByAgentId: author.id,
      metadata: { version: 1, confidence: 'stated' },
    })
    const alphaOnly = await dbModule.createMemoryItem({
      scope: 'agent',
      subjectAgentId: alpha.id,
      kind: 'note',
      content: 'Watch the deployment queue.',
    })
    const betaOnly = await dbModule.createMemoryItem({
      scope: 'agent',
      subjectAgentId: beta.id,
      kind: 'log',
      content: 'Beta completed the audit.',
    })

    expect(shared.id).toMatch(/^mem_/)
    expect(shared.authoredByAgentId).toBe(author.id)
    expect(shared.metadataJson).toEqual({ version: 1, confidence: 'stated' })
    expect(alphaOnly.metadataJson).toEqual({ version: 1 })

    expect(await dbModule.listMemoryItems({ scope: 'user' })).toEqual([shared])
    expect(
      await dbModule.listMemoryItems({ scope: 'agent', subjectAgentId: alpha.id }),
    ).toEqual([alphaOnly])
    expect(
      await dbModule.listMemoryItems({ scope: 'agent', subjectAgentId: beta.id }),
    ).toEqual([betaOnly])

    const relevant = await dbModule.listPromptMemoryForAgent(alpha.id)
    expect(relevant.map((item) => item.id)).toEqual([shared.id, alphaOnly.id])
    expect(relevant.map((item) => item.id)).not.toContain(betaOnly.id)

    const sharedSelector = { id: shared.id, scope: 'user' as const }
    const updated = await dbModule.updateMemoryItem(sharedSelector, {
      kind: 'note',
      content: 'The user prefers short, factual updates.',
      metadata: { version: 1, confidence: 'confirmed' },
    })
    expect(updated).toMatchObject({
      id: shared.id,
      scope: 'user',
      subjectAgentId: null,
      authoredByAgentId: author.id,
      kind: 'note',
      content: 'The user prefers short, factual updates.',
      metadataJson: { version: 1, confidence: 'confirmed' },
      createdAt: shared.createdAt,
    })
    expect(await dbModule.getMemoryItem(sharedSelector)).toEqual(updated)
    expect(
      await dbModule.getMemoryItem({
        id: betaOnly.id,
        scope: 'agent',
        subjectAgentId: alpha.id,
      }),
    ).toBeUndefined()

    expect(await dbModule.deleteMemoryItem(sharedSelector)).toBe(true)
    expect(await dbModule.getMemoryItem(sharedSelector)).toBeUndefined()
    expect(await dbModule.deleteMemoryItem(sharedSelector)).toBe(false)
  })

  it('validates versioned metadata before create or update', async () => {
    await expect(
      dbModule.createMemoryItem({
        scope: 'user',
        kind: 'note',
        content: 'Invalid metadata',
        metadata: { version: 2 } as never,
      }),
    ).rejects.toThrow()

    const item = await dbModule.createMemoryItem({
      scope: 'user',
      kind: 'note',
      content: 'Valid metadata',
    })
    await expect(
      dbModule.updateMemoryItem({ id: item.id, scope: 'user' }, {
        metadata: { version: 2 } as never,
      }),
    ).rejects.toThrow()
  })

  it('survives conversation clearing and server restart', async () => {
    const { agent, conversation } = await dbModule.createAgent({ name: 'Durable Memory' })
    const item = await dbModule.createMemoryItem({
      scope: 'agent',
      subjectAgentId: agent.id,
      kind: 'profile',
      content: 'Owns the release checklist.',
    })

    const freshConversation = await dbModule.clearConversation(conversation.id)
    expect(freshConversation.currentCheckpointId).toBeNull()
    const selector = {
      id: item.id,
      scope: 'agent' as const,
      subjectAgentId: agent.id,
    }
    expect(await dbModule.getMemoryItem(selector)).toEqual(item)

    vi.resetModules()
    const reloaded: DbModule = await import('./index')
    expect(await reloaded.getMemoryItem(selector)).toEqual(item)
  })

  it('preserves shared memory but clears deleted author provenance', async () => {
    const { agent: author } = await dbModule.createAgent({ name: 'Departing Author' })
    const { agent: subject } = await dbModule.createAgent({ name: 'Departing Subject' })
    const shared = await dbModule.createMemoryItem({
      scope: 'user',
      kind: 'log',
      content: 'A durable shared observation.',
      authoredByAgentId: author.id,
    })
    const scoped = await dbModule.createMemoryItem({
      scope: 'agent',
      subjectAgentId: subject.id,
      kind: 'note',
      content: 'Removed with its subject.',
    })

    await dbModule.db.delete(dbModule.agents).where(eq(dbModule.agents.id, author.id))
    expect(
      await dbModule.getMemoryItem({ id: shared.id, scope: 'user' }),
    ).toMatchObject({
      id: shared.id,
      authoredByAgentId: null,
    })

    await dbModule.db.delete(dbModule.agents).where(eq(dbModule.agents.id, subject.id))
    expect(
      await dbModule.getMemoryItem({
        id: scoped.id,
        scope: 'agent',
        subjectAgentId: subject.id,
      }),
    ).toBeUndefined()
  })

  it('searches accessible memory grep-style, scoped, recent first, with limit', async () => {
    const { agent: alpha } = await dbModule.createAgent({ name: 'Search Alpha' })
    const { agent: beta } = await dbModule.createAgent({ name: 'Search Beta' })
    const first = await dbModule.createMemoryItem({
      scope: 'agent',
      subjectAgentId: alpha.id,
      kind: 'note',
      content: 'Rotate the signing key quarterly.',
    })
    await new Promise((resolve) => setTimeout(resolve, 5))
    const second = await dbModule.createMemoryItem({
      scope: 'user',
      kind: 'note',
      content: 'The user rotates keys on Mondays.',
    })
    await dbModule.createMemoryItem({
      scope: 'agent',
      subjectAgentId: beta.id,
      kind: 'note',
      content: 'Beta key rotation is unrelated.',
    })
    await dbModule.createMemoryItem({
      scope: 'user',
      kind: 'note',
      content: 'Content with 100% literal_percent characters.',
    })

    // Other agents' private memory is invisible; results are newest first.
    const found = await dbModule.searchMemoryForAgent(alpha.id, { query: 'key' })
    expect(found.map((item) => item.id)).toEqual([second.id, first.id])

    // Scope narrows to shared or own-agent memory.
    expect(
      (await dbModule.searchMemoryForAgent(alpha.id, { query: 'key', scope: 'user' })).map(
        (item) => item.id,
      ),
    ).toEqual([second.id])
    expect(
      (await dbModule.searchMemoryForAgent(alpha.id, { query: 'key', scope: 'agent' })).map(
        (item) => item.id,
      ),
    ).toEqual([first.id])

    // '*' spans words; LIKE metacharacters in the query stay literal.
    expect(
      (await dbModule.searchMemoryForAgent(alpha.id, { query: 'rotate*quarterly' })).map(
        (item) => item.id,
      ),
    ).toEqual([first.id])
    expect(
      await dbModule.searchMemoryForAgent(alpha.id, { query: '100% literal_percent' }),
    ).toHaveLength(1)
    expect(await dbModule.searchMemoryForAgent(alpha.id, { query: '5% literal' })).toHaveLength(0)

    expect(await dbModule.searchMemoryForAgent(alpha.id, { query: 'key', limit: 1 })).toHaveLength(1)

    // Recency follows updates, not just creation.
    await new Promise((resolve) => setTimeout(resolve, 5))
    await dbModule.updateMemoryItem(
      { id: first.id, scope: 'agent', subjectAgentId: alpha.id },
      { content: 'Rotate the signing key monthly.' },
    )
    const reordered = await dbModule.searchMemoryForAgent(alpha.id, { query: 'key' })
    expect(reordered[0]?.id).toBe(first.id)
  })

  it('strips legacy frozen-memory snapshots from checkpoint state', () => {
    const state = dbModule.checkpointStateSchema.parse({
      version: 1,
      modelMessages: [{ role: 'system', content: 'old epoch' }],
      memoryPromptsByAgent: { agent_legacy: 'frozen memory' },
    })
    expect(state).toEqual({
      version: 1,
      modelMessages: [{ role: 'system', content: 'old epoch' }],
    })
  })
})
