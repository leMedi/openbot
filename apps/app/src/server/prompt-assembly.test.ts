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

describe('private prompt memory', () => {
  it('includes relevant provenance and freezes it in the checkpoint epoch', async () => {
    const { agent: alpha, conversation } = await db.createAgent({ name: 'Alpha' })
    const { agent: beta } = await db.createAgent({ name: 'Beta' })
    const shared = await db.createMemoryItem({
      scope: 'user',
      kind: 'profile',
      content: 'Prefers concise answers.',
      authoredByAgentId: beta.id,
    })
    const alphaMemory = await db.createMemoryItem({
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
    const { turn: firstTurn } = await db.acceptUserMessage({
      conversationId: conversation.id,
      text: 'What should I know?',
    })

    const firstPrompt = await prompts.assemblePrivateModelMessages({
      agent: alpha,
      conversationId: conversation.id,
      turnId: firstTurn.id,
    })
    const systemPrompt = firstPrompt[0]?.content ?? ''
    expect(systemPrompt).toContain('Prefers concise answers.')
    expect(systemPrompt).toContain(`authored by agent ${beta.id}`)
    expect(systemPrompt).toContain('Track release readiness.')
    expect(systemPrompt).not.toContain('This belongs only to Beta.')
    expect(firstPrompt.at(-1)).toEqual({
      role: 'user',
      content: 'What should I know?',
    })

    await db.createConversationCheckpoint(conversation.id, {
      version: 1,
      modelMessages: firstPrompt,
    })
    await db.updateMemoryItem(
      { id: shared.id, scope: 'user' },
      { content: 'Now prefers detailed answers.' },
    )
    await db.deleteMemoryItem({
      id: alphaMemory.id,
      scope: 'agent',
      subjectAgentId: alpha.id,
    })
    const { turn: secondTurn } = await db.acceptUserMessage({
      conversationId: conversation.id,
      text: 'Has anything changed?',
    })

    const frozenPrompt = await prompts.assemblePrivateModelMessages({
      agent: alpha,
      conversationId: conversation.id,
      turnId: secondTurn.id,
    })
    expect(frozenPrompt[0]).toEqual(firstPrompt[0])
    expect(frozenPrompt[0]?.content).not.toContain('Now prefers detailed answers.')
    expect(frozenPrompt.at(-1)).toEqual({
      role: 'user',
      content: 'Has anything changed?',
    })

    const freshConversation = await db.clearConversation(conversation.id)
    const { turn: freshTurn } = await db.acceptUserMessage({
      conversationId: freshConversation.id,
      text: 'Start fresh.',
    })
    const freshPrompt = await prompts.assemblePrivateModelMessages({
      agent: alpha,
      conversationId: freshConversation.id,
      turnId: freshTurn.id,
    })
    expect(freshPrompt[0]?.content).toContain('Now prefers detailed answers.')
    expect(freshPrompt[0]?.content).not.toContain('Track release readiness.')
  })
})

describe('group prompt memory', () => {
  it("freezes each member's memory within the shared checkpoint epoch", async () => {
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
    expect(firstPrompt.modelMessages[0]?.content).toContain(
      'Alpha remembers the first version.',
    )
    await db.createConversationCheckpoint(conversation.id, {
      version: 1,
      modelMessages: firstPrompt.modelMessages,
      memoryPromptsByAgent: { [alpha.id]: firstPrompt.memoryPrompt },
    })
    await db.updateMemoryItem(
      { id: memory.id, scope: 'agent', subjectAgentId: alpha.id },
      { content: 'Alpha remembers the changed version.' },
    )

    const frozenPrompt = await prompts.assembleGroupModelMessages({
      agent: alpha,
      group,
      members: [alpha, beta],
      conversationId: conversation.id,
    })
    expect(frozenPrompt.modelMessages[0]).toEqual(firstPrompt.modelMessages[0])
    expect(frozenPrompt.modelMessages[0]?.content).not.toContain(
      'Alpha remembers the changed version.',
    )
  })
})
