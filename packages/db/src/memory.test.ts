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

  it('merges group member memory snapshots during successive completion', async () => {
    const { agent: alpha } = await dbModule.createAgent({ name: 'Merge Alpha' })
    const { agent: beta } = await dbModule.createAgent({ name: 'Merge Beta' })
    const { conversation } = await dbModule.createGroup({
      name: 'Merge Room',
      members: [
        { type: 'agent', agentId: alpha.id },
        { type: 'agent', agentId: beta.id },
      ],
    })

    async function prepareChild(agentId: string, text: string) {
      const { turn: groupTurn } = await dbModule.acceptUserMessage({
        conversationId: conversation.id,
        text,
      })
      await dbModule.claimQueuedTurn(groupTurn.id)
      const { childTurn } = await dbModule.queueGroupChildTurn({
        groupTurnId: groupTurn.id,
        targetAgentId: agentId,
      })
      await dbModule.claimQueuedTurn(childTurn.id)
      return childTurn
    }

    const alphaTurn = await prepareChild(alpha.id, 'Alpha should answer')
    const betaTurn = await prepareChild(beta.id, 'Beta should answer')
    await dbModule.finalizeTurnSuccess({
      turnId: alphaTurn.id,
      conversationId: conversation.id,
      assistantText: 'Alpha answer',
      checkpointState: { version: 1, modelMessages: [] },
      memoryPrompt: { agentId: alpha.id, prompt: 'alpha frozen memory' },
    })
    await dbModule.finalizeTurnSuccess({
      turnId: betaTurn.id,
      conversationId: conversation.id,
      assistantText: 'Beta answer',
      checkpointState: { version: 1, modelMessages: [] },
      memoryPrompt: { agentId: beta.id, prompt: 'beta frozen memory' },
    })

    const checkpoint = await dbModule.getCurrentCheckpoint(conversation.id)
    const state = dbModule.checkpointStateSchema.parse(checkpoint?.stateJson)
    expect(state.memoryPromptsByAgent).toEqual({
      [alpha.id]: 'alpha frozen memory',
      [beta.id]: 'beta frozen memory',
    })
  })
})
