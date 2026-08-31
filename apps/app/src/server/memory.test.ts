import { mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

const dataDirectory = mkdtempSync(path.join(os.tmpdir(), 'openbot-memory-api-test-'))
process.env.OPENBOT_DATA_DIR = dataDirectory

type DbModule = typeof import('@openbot/db')
type MemoryServerModule = typeof import('./memory-handlers.server')

let dbModule: DbModule
let memoryServer: MemoryServerModule

beforeAll(async () => {
  ;[dbModule, memoryServer] = await Promise.all([
    import('@openbot/db'),
    import('./memory-handlers.server'),
  ])
})

describe('memory server boundary', () => {
  it('validates and performs scope-qualified CRUD', async () => {
    const { agent: alpha } = await dbModule.createAgent({ name: 'API Alpha' })
    const { agent: beta } = await dbModule.createAgent({ name: 'API Beta' })
    const created = await memoryServer.createMemory({
      scope: 'agent',
      subjectAgentId: alpha.id,
      kind: 'profile',
      content: 'Alpha owns this memory.',
    })

    const listed = await memoryServer.listMemory({
      scope: 'agent',
      subjectAgentId: alpha.id,
    })
    expect(listed.map((item) => item.id)).toContain(created.id)
    await expect(
      memoryServer.findMemory({
        id: created.id,
        scope: 'agent',
        subjectAgentId: beta.id,
      }),
    ).rejects.toThrow(/not found/i)

    const updated = await memoryServer.changeMemory({
      selector: {
        id: created.id,
        scope: 'agent',
        subjectAgentId: alpha.id,
      },
      patch: { kind: 'note', content: 'Alpha still owns this memory.' },
    })
    expect(updated.kind).toBe('note')

    await memoryServer.forgetMemory({
      id: created.id,
      scope: 'agent',
      subjectAgentId: alpha.id,
    })
    await expect(
      memoryServer.findMemory({
        id: created.id,
        scope: 'agent',
        subjectAgentId: alpha.id,
      }),
    ).rejects.toThrow(/not found/i)
  })

  it('rejects unsupported metadata versions before storage', async () => {
    expect(() =>
      memoryServer.createMemory({
        scope: 'user',
        kind: 'log',
        content: 'Bad metadata',
        metadata: { version: 2 } as never,
      }),
    ).toThrow()
  })
})
