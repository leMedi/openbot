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

describe('runShell tool', () => {
  it('runs a command in the agent workspace and reports exit status', async () => {
    const { agent } = await db.createAgent({ name: 'Shell Alpha' })

    const ok = await run(agent, 'runShell', { command: 'echo hello && pwd' })
    expect(ok.status).toBe('complete')
    expect(ok.exitCode).toBe(0)
    expect(ok.shell_id).toBeTruthy()
    expect(ok.output).toContain('hello')
    expect(ok.output).toContain(path.join('workspaces', agent.id))

    const failing = await run(agent, 'runShell', { command: 'echo oops >&2; exit 3' })
    expect(failing.exitCode).toBe(3)
    expect(failing.output).toContain('oops')
  })

  it('persists workspace files across calls and confines cwd', async () => {
    const { agent } = await db.createAgent({ name: 'Shell Beta' })

    await run(agent, 'runShell', { command: 'mkdir -p sub && echo data > sub/file.txt' })
    const readBack = await run(agent, 'runShell', { command: 'cat file.txt', cwd: 'sub' })
    expect(readBack.output.trim()).toBe('data')

    const escape = await run(agent, 'runShell', { command: 'pwd', cwd: '../..' })
    expect(escape.error).toContain('workspace')
  })

  it('hands back a still-running shell when the timeout elapses', async () => {
    const { agent } = await db.createAgent({ name: 'Shell Gamma' })

    const result = await run(agent, 'runShell', {
      command: 'echo started; sleep 5; echo finished',
      timeoutSeconds: 1,
    })
    expect(result.status).toBe('running')
    expect(result.output).toContain('started')
    expect(result.output).not.toContain('finished')

    // The command was not killed: it can still be awaited to completion.
    const done = await run(agent, 'AwaitShell', {
      shell_id: result.shell_id,
      block_until_ms: 10_000,
    })
    expect(done.status).toBe('complete')
    expect(done.exitCode).toBe(0)
  }, 20_000)
})

describe('Read tool', () => {
  it('reads whole files and line ranges with optional line numbers', async () => {
    const { agent } = await db.createAgent({ name: 'Read Alpha' })
    await run(agent, 'runShell', { command: 'printf "one\\ntwo\\nthree\\nfour\\n" > lines.txt' })

    const whole = await run(agent, 'Read', { path: 'lines.txt' })
    expect(whole.content).toBe('one\ntwo\nthree\nfour')
    expect(whole).toMatchObject({ totalLines: 4, startLine: 1, endLine: 4 })

    const range = await run(agent, 'Read', { path: 'lines.txt', offset: 2, limit: 2 })
    expect(range.content).toBe('two\nthree')
    expect(range).toMatchObject({ startLine: 2, endLine: 3 })

    const tail = await run(agent, 'Read', { path: 'lines.txt', offset: -2 })
    expect(tail.content).toBe('three\nfour')

    const numbered = await run(agent, 'Read', {
      path: 'lines.txt',
      offset: 3,
      limit: 1,
      include_line_numbers: true,
    })
    expect(numbered.content).toBe('3\tthree')
  })

  it('rejects escapes, missing files, and out-of-range offsets', async () => {
    const { agent } = await db.createAgent({ name: 'Read Beta' })

    const escape = await run(agent, 'Read', { path: '../other/secrets.txt' })
    expect(escape.error).toContain('workspace')

    const missing = await run(agent, 'Read', { path: 'nope.txt' })
    expect(missing.error).toContain('not found')

    await run(agent, 'runShell', { command: 'echo only-line > short.txt' })
    const beyond = await run(agent, 'Read', { path: 'short.txt', offset: 5 })
    expect(beyond.error).toContain('beyond')
  })
})

describe('AwaitShell tool', () => {
  it('tracks a background shell from running to complete', async () => {
    const { agent } = await db.createAgent({ name: 'Await Alpha' })

    const started = await run(agent, 'runShell', {
      command: 'echo ready; sleep 0.5; echo finished',
      background: true,
    })
    expect(started.status).toBe('running')
    expect(started.shell_id).toBeTruthy()

    const check = await run(agent, 'AwaitShell', { shell_id: started.shell_id, block_until_ms: 0 })
    expect(check.status).toBe('running')

    const done = await run(agent, 'AwaitShell', {
      shell_id: started.shell_id,
      block_until_ms: 10_000,
    })
    expect(done.status).toBe('complete')
    expect(done.exitCode).toBe(0)

    const output = await run(agent, 'Read', { path: done.outputPath })
    expect(output.content).toBe('ready\nfinished')
  }, 15_000)

  it('returns early on a pattern match while still running', async () => {
    const { agent } = await db.createAgent({ name: 'Await Beta' })

    const started = await run(agent, 'runShell', {
      command: 'echo server listening on 3000; sleep 5',
      background: true,
    })
    const matched = await run(agent, 'AwaitShell', {
      shell_id: started.shell_id,
      block_until_ms: 10_000,
      pattern: 'listening on \\d+',
    })
    expect(matched.status).toBe('running')
    expect(matched.patternMatch).toBe('listening on 3000')
  }, 15_000)

  it('sleeps without a shell id and rejects unknown ids', async () => {
    const { agent } = await db.createAgent({ name: 'Await Gamma' })

    const slept = await run(agent, 'AwaitShell', { block_until_ms: 100 })
    expect(slept.slept_ms).toBe(100)

    const unknown = await run(agent, 'AwaitShell', { shell_id: '999', block_until_ms: 0 })
    expect(unknown.error).toContain('No shell found')

    const invalid = await run(agent, 'AwaitShell', { block_until_ms: 0 })
    expect(invalid.error).toContain('shell_id')
  })
})
