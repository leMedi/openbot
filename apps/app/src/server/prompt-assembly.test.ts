import { mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

const dataDirectory = mkdtempSync(path.join(os.tmpdir(), 'openbot-prompt-test-'))
process.env.OPENBOT_DATA_DIR = dataDirectory

type DbModule = typeof import('@openbot/db')
type PromptModule = typeof import('./prompt-assembly')

let db: DbModule
let prompts: PromptModule

beforeAll(async () => {
  ;[db, prompts] = await Promise.all([
    import('@openbot/db'),
    import('./prompt-assembly'),
  ])
})

describe('memory prompt rendering', () => {
  it('renders shared and agent sections with dates, provenance, and scope isolation', async () => {
    const { agent: alpha } = await db.createAgent({ name: 'Render Alpha' })
    const { agent: beta } = await db.createAgent({ name: 'Render Beta' })
    await db.createMemoryItem({
      scope: 'user',
      kind: 'profile',
      content: 'The user works as a software engineer.',
      authoredByAgentId: beta.id,
      authoredByAgentName: beta.name,
    })
    await db.createMemoryItem({
      scope: 'agent',
      subjectAgentId: alpha.id,
      kind: 'note',
      content: 'Track release readiness.',
    })
    await db.createMemoryItem({
      scope: 'agent',
      subjectAgentId: beta.id,
      kind: 'note',
      content: 'This belongs only to Beta.',
    })

    const rendered = prompts.renderMemoryPrompt(
      await db.listPromptMemoryForAgent(alpha.id),
    )
    expect(rendered).toContain('About the user (shared):')
    expect(rendered).toContain('[via Render Beta]')
    expect(rendered).toContain('The user works as a software engineer.')
    expect(rendered).toContain('About the user:')
    expect(rendered).toContain('Track release readiness.')
    expect(rendered).not.toContain('This belongs only to Beta.')
    expect(rendered).toMatch(/\(learned \d{4}-\d{2}-\d{2}\)/)
  })

  it('bounds the recent section and points overflow at recallMemory', () => {
    const now = Date.now()
    const items = Array.from({ length: 20 }, (_, index) => ({
      id: `mem_${String(index).padStart(3, '0')}`,
      scope: 'agent' as const,
      subjectAgentId: 'agent_x',
      authoredByAgentId: null,
      authoredByAgentName: null,
      kind: 'note' as const,
      content: `Fact number ${index}`,
      metadataJson: { version: 1 as const },
      createdAt: now,
      updatedAt: now + index,
    }))
    const rendered = prompts.renderMemorySystemPrompt(items)
    // 15 recent records survive; the 5 oldest are folded into the omission line.
    expect(rendered).toContain('Fact number 19')
    expect(rendered).not.toContain('Fact number 0\n')
    expect(rendered).toContain('5 more facts not shown — search them with recallMemory.')
  })

  it('renders empty sections as nothing', () => {
    expect(prompts.renderUserMemorySystemPrompt([])).toBe('')
    expect(prompts.renderMemorySystemPrompt([])).toBe('')
    expect(prompts.renderMemoryPrompt([])).toBe('')
  })
})

describe('dynamic private prompt', () => {
  it('re-renders the system prompt from live memory while keeping checkpoint history', async () => {
    const { agent: alpha, conversation } = await db.createAgent({ name: 'Alpha' })
    const shared = await db.createMemoryItem({
      scope: 'user',
      kind: 'profile',
      content: 'Prefers concise answers.',
    })
    const { turn: firstTurn } = await db.acceptUserMessage({
      conversationId: conversation.id,
      text: 'What should I know?',
    })

    const firstPrompt = await prompts.assemblePrivateModelMessages({
      agent: alpha,
      conversationId: conversation.id,
      turnId: firstTurn.id,
    })
    expect(firstPrompt[0]?.role).toBe('system')
    expect(firstPrompt[0]?.content).toContain('Prefers concise answers.')
    expect(firstPrompt[0]?.content).toContain('Agent profile:')
    expect(firstPrompt.at(-1)).toEqual({
      role: 'user',
      content: 'What should I know?',
    })

    await db.createConversationCheckpoint(conversation.id, {
      version: 1,
      modelMessages: [
        ...firstPrompt,
        { role: 'assistant', content: 'Noted.' },
      ],
    })
    await db.updateMemoryItem(
      { id: shared.id, scope: 'user' },
      { content: 'Now prefers detailed answers.' },
    )
    const { turn: secondTurn } = await db.acceptUserMessage({
      conversationId: conversation.id,
      text: 'Has anything changed?',
    })

    const secondPrompt = await prompts.assemblePrivateModelMessages({
      agent: alpha,
      conversationId: conversation.id,
      turnId: secondTurn.id,
    })
    // Fresh system prompt reflects the live memory edit...
    expect(secondPrompt[0]?.role).toBe('system')
    expect(secondPrompt[0]?.content).toContain('Now prefers detailed answers.')
    expect(secondPrompt[0]?.content).not.toContain('Prefers concise answers.')
    // ...while checkpointed history is replayed without its stale system prompt.
    expect(secondPrompt.filter((message) => message.role === 'system')).toHaveLength(1)
    expect(secondPrompt.map((message) => message.content)).toContain('Noted.')
    expect(secondPrompt.at(-1)).toEqual({
      role: 'user',
      content: 'Has anything changed?',
    })
  })
})

describe('dynamic group prompt', () => {
  it("re-renders each member's memory on every run", async () => {
    const { agent: alpha } = await db.createAgent({ name: 'Group Alpha' })
    const { agent: beta } = await db.createAgent({ name: 'Group Beta' })
    const { group, conversation } = await db.createGroup({
      name: 'Memory Room',
      members: [
        { type: 'agent', agentId: alpha.id },
        { type: 'agent', agentId: beta.id },
      ],
    })
    const memory = await db.createMemoryItem({
      scope: 'agent',
      subjectAgentId: alpha.id,
      kind: 'note',
      content: 'Alpha remembers the first version.',
    })

    const firstPrompt = await prompts.assembleGroupModelMessages({
      agent: alpha,
      group,
      members: [alpha, beta],
      conversationId: conversation.id,
    })
    expect(firstPrompt[0]?.content).toContain('Alpha remembers the first version.')
    expect(firstPrompt[0]?.content).toContain('shared group room "Memory Room"')

    await db.updateMemoryItem(
      { id: memory.id, scope: 'agent', subjectAgentId: alpha.id },
      { content: 'Alpha remembers the changed version.' },
    )
    const secondPrompt = await prompts.assembleGroupModelMessages({
      agent: alpha,
      group,
      members: [alpha, beta],
      conversationId: conversation.id,
    })
    expect(secondPrompt[0]?.content).toContain('Alpha remembers the changed version.')
    expect(secondPrompt[0]?.content).not.toContain('Alpha remembers the first version.')
  })
})
