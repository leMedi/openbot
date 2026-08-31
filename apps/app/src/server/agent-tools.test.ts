import { mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

const dataDirectory = mkdtempSync(path.join(os.tmpdir(), 'openbot-agent-tools-test-'))
process.env.OPENBOT_DATA_DIR = dataDirectory

type DbModule = typeof import('@openbot/db')
type ToolsModule = typeof import('./agent-tools')

let db: DbModule
let tools: ToolsModule

beforeAll(async () => {
  ;[db, tools] = await Promise.all([import('@openbot/db'), import('./agent-tools')])
})

function call(name: string, args: unknown) {
  return {
    id: `call_${Math.random().toString(36).slice(2)}`,
    type: 'function' as const,
    function: { name, arguments: JSON.stringify(args) },
  }
}

async function run(agent: { id: string; name: string }, name: string, args: unknown) {
  const result = await tools.executeAgentToolCall(
    agent as never,
    call(name, args),
  )
  return JSON.parse(result)
}

describe('updateMemory tool', () => {
  it('records, edits, and forgets facts with author provenance', async () => {
    const { agent } = await db.createAgent({ name: 'Tool Alpha' })

    const created = await run(agent, 'updateMemory', {
      action: 'update',
      scope: 'user',
      kind: 'profile',
      content: 'The user is vegetarian.',
    })
    expect(created.created.id).toMatch(/^mem_/)
    expect(created.created.scope).toBe('user')
    const stored = await db.getMemoryItem({ id: created.created.id, scope: 'user' })
    expect(stored).toMatchObject({
      authoredByAgentId: agent.id,
      authoredByAgentName: 'Tool Alpha',
      kind: 'profile',
    })

    // Without a scope, a new fact defaults to the agent's private memory.
    const privately = await run(agent, 'updateMemory', {
      action: 'update',
      content: 'Owns the release checklist.',
    })
    expect(privately.created.scope).toBe('agent')

    const edited = await run(agent, 'updateMemory', {
      action: 'update',
      id: created.created.id,
      content: 'The user is vegan.',
    })
    expect(edited.updated.content).toBe('The user is vegan.')

    const forgotten = await run(agent, 'updateMemory', {
      action: 'forget',
      id: created.created.id,
    })
    expect(forgotten).toEqual({ forgotten: created.created.id })
    expect(await db.getMemoryItem({ id: created.created.id, scope: 'user' })).toBeUndefined()
  })

  it("cannot touch another agent's private memory", async () => {
    const { agent: alpha } = await db.createAgent({ name: 'Tool Guard Alpha' })
    const { agent: beta } = await db.createAgent({ name: 'Tool Guard Beta' })
    const betaOnly = await db.createMemoryItem({
      scope: 'agent',
      subjectAgentId: beta.id,
      kind: 'note',
      content: 'Beta private fact.',
    })

    const editAttempt = await run(alpha, 'updateMemory', {
      action: 'update',
      id: betaOnly.id,
      content: 'Hijacked.',
    })
    expect(editAttempt.error).toMatch(/not found/i)
    const forgetAttempt = await run(alpha, 'updateMemory', {
      action: 'forget',
      id: betaOnly.id,
    })
    expect(forgetAttempt.error).toMatch(/not found/i)
    expect(
      await db.getMemoryItem({
        id: betaOnly.id,
        scope: 'agent',
        subjectAgentId: beta.id,
      }),
    ).toMatchObject({ content: 'Beta private fact.' })
  })

  it('answers bad arguments with a correctable error payload', async () => {
    const { agent } = await db.createAgent({ name: 'Tool Errors' })
    expect(
      await run(agent, 'updateMemory', { action: 'update' }),
    ).toMatchObject({ error: expect.stringMatching(/content/i) })
    expect(await run(agent, 'nonexistentTool', {})).toMatchObject({
      error: expect.stringMatching(/unknown tool/i),
    })
    const malformed = await tools.executeAgentToolCall(agent as never, {
      id: 'call_bad',
      type: 'function',
      function: { name: 'updateMemory', arguments: '{not json' },
    })
    expect(JSON.parse(malformed).error).toMatch(/valid JSON/i)
  })
})

describe('recallMemory tool', () => {
  it('searches accessible memory with scope filter, wildcard, and recency order', async () => {
    const { agent: alpha } = await db.createAgent({ name: 'Recall Alpha' })
    const { agent: beta } = await db.createAgent({ name: 'Recall Beta' })
    const older = await db.createMemoryItem({
      scope: 'agent',
      subjectAgentId: alpha.id,
      kind: 'note',
      content: 'Deploy window opens Friday.',
    })
    await new Promise((resolve) => setTimeout(resolve, 5))
    await db.createMemoryItem({
      scope: 'user',
      kind: 'note',
      content: 'The user deploys on Fridays only.',
    })
    await db.createMemoryItem({
      scope: 'agent',
      subjectAgentId: beta.id,
      kind: 'note',
      content: 'Deploy secrets live in the beta vault.',
    })

    const everything = await run(alpha, 'recallMemory', { query: 'deploy' })
    expect(everything.count).toBe(2)
    expect(everything.items.map((item: { content: string }) => item.content)).toEqual([
      'The user deploys on Fridays only.',
      'Deploy window opens Friday.',
    ])

    const scoped = await run(alpha, 'recallMemory', { query: 'deploy', scope: 'agent' })
    expect(scoped.items.map((item: { id: string }) => item.id)).toEqual([older.id])

    const wildcard = await run(alpha, 'recallMemory', { query: 'window*friday' })
    expect(wildcard.count).toBe(1)

    const limited = await run(alpha, 'recallMemory', { query: 'deploy', limit: 1 })
    expect(limited.count).toBe(1)
    expect(limited.items[0].content).toBe('The user deploys on Fridays only.')
  })
})
