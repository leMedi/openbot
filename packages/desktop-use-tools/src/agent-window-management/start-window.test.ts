import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  EXIT_UNAVAILABLE,
  parseStartWindowArguments,
  provisionAgentWindow,
  type StartWindowDependencies,
} from './start-window-core'

async function fixture(overrides: Partial<StartWindowDependencies> = {}) {
  const stateDirectory = await mkdtemp(join(tmpdir(), 'openbot-start-window-test-'))
  const launched: number[] = []
  const dependencies: StartWindowDependencies = {
    stateDirectory,
    processId: 900,
    now: () => '2026-09-05T12:00:00.000Z',
    acquireOperationLock: async () => async () => undefined,
    isProcessAlive: (pid) => pid === 901,
    isDisplayOccupied: async () => false,
    launchXvfb: async (displayNumber) => {
      launched.push(displayNumber)
      return { pid: 901, stop: async () => undefined }
    },
    ...overrides,
  }
  return { dependencies, launched, stateDirectory }
}

test('parses a display number and owner id', () => {
  assert.deepEqual(parseStartWindowArguments(['2', 'agent-123']), {
    displayNumber: 2,
    ownerId: 'agent-123',
  })
})

test('rejects malformed arguments', () => {
  assert.throws(() => parseStartWindowArguments([':2', 'agent-123']), /display-number/)
  assert.throws(() => parseStartWindowArguments(['2', 'bad\nowner']), /owner-id/)
  assert.throws(() => parseStartWindowArguments(['2']), /Usage/)
})

test('starts Xvfb and records the display owner', async () => {
  const { dependencies, launched, stateDirectory } = await fixture()

  const result = await provisionAgentWindow(
    { displayNumber: 2, ownerId: 'agent-123' },
    dependencies,
  )

  assert.deepEqual(result, { exitCode: 0 })
  assert.deepEqual(launched, [2])
  const state = JSON.parse(await readFile(join(stateDirectory, 'display-2.json'), 'utf8'))
  assert.deepEqual(state, {
    version: 1,
    status: 'running',
    displayNumber: 2,
    ownerId: 'agent-123',
    pid: 901,
    width: 1280,
    height: 800,
    depth: 24,
    startedAt: '2026-09-05T12:00:00.000Z',
  })
})

test('succeeds without restarting a healthy display owned by the same agent', async () => {
  const { dependencies, launched, stateDirectory } = await fixture({
    isDisplayOccupied: async () => true,
  })
  await writeFile(
    join(stateDirectory, 'display-2.json'),
    JSON.stringify({
      version: 1,
      status: 'running',
      displayNumber: 2,
      ownerId: 'agent-123',
      pid: 901,
      width: 1280,
      height: 800,
      depth: 24,
      startedAt: '2026-09-05T11:00:00.000Z',
    }),
  )

  const result = await provisionAgentWindow(
    { displayNumber: 2, ownerId: 'agent-123' },
    dependencies,
  )

  assert.deepEqual(result, { exitCode: 0 })
  assert.deepEqual(launched, [])
})

test('returns 75 when another agent owns the display', async () => {
  const { dependencies, launched, stateDirectory } = await fixture({
    isDisplayOccupied: async () => true,
  })
  await writeFile(
    join(stateDirectory, 'display-2.json'),
    JSON.stringify({
      version: 1,
      status: 'running',
      displayNumber: 2,
      ownerId: 'agent-456',
      pid: 901,
      width: 1280,
      height: 800,
      depth: 24,
      startedAt: '2026-09-05T11:00:00.000Z',
    }),
  )

  const result = await provisionAgentWindow(
    { displayNumber: 2, ownerId: 'agent-123' },
    dependencies,
  )

  assert.equal(result.exitCode, EXIT_UNAVAILABLE)
  assert.match(result.error ?? '', /owned by another agent/)
  assert.deepEqual(launched, [])
})

test('returns 75 when an unmanaged X display occupies the number', async () => {
  const { dependencies, launched } = await fixture({
    isDisplayOccupied: async () => true,
  })

  const result = await provisionAgentWindow(
    { displayNumber: 2, ownerId: 'agent-123' },
    dependencies,
  )

  assert.equal(result.exitCode, EXIT_UNAVAILABLE)
  assert.match(result.error ?? '', /unavailable/)
  assert.deepEqual(launched, [])
})

test('returns 75 while another invocation is provisioning the display', async () => {
  const { dependencies, launched } = await fixture({
    acquireOperationLock: async () => undefined,
  })

  const result = await provisionAgentWindow(
    { displayNumber: 2, ownerId: 'agent-123' },
    dependencies,
  )

  assert.equal(result.exitCode, EXIT_UNAVAILABLE)
  assert.match(result.error ?? '', /still being started/)
  assert.deepEqual(launched, [])
})

test('replaces stale state before starting the display', async () => {
  const { dependencies, launched, stateDirectory } = await fixture()
  await writeFile(
    join(stateDirectory, 'display-2.json'),
    JSON.stringify({
      version: 1,
      status: 'running',
      displayNumber: 2,
      ownerId: 'old-agent',
      pid: 899,
      width: 1280,
      height: 800,
      depth: 24,
      startedAt: '2026-09-05T11:00:00.000Z',
    }),
  )

  const result = await provisionAgentWindow(
    { displayNumber: 2, ownerId: 'agent-123' },
    dependencies,
  )

  assert.deepEqual(result, { exitCode: 0 })
  assert.deepEqual(launched, [2])
})

test('removes its ownership claim when Xvfb startup fails', async () => {
  const { dependencies, stateDirectory } = await fixture({
    launchXvfb: async () => {
      throw new Error('Xvfb could not load a font')
    },
  })

  const result = await provisionAgentWindow(
    { displayNumber: 2, ownerId: 'agent-123' },
    dependencies,
  )

  assert.equal(result.exitCode, 1)
  assert.equal(result.error, 'Xvfb could not load a font')
  await assert.rejects(readFile(join(stateDirectory, 'display-2.json')), /ENOENT/)
})
