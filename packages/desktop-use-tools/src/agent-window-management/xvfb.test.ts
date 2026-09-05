import assert from 'node:assert/strict'
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { displayIsOccupied } from './xvfb'

test('removes stale X artifacts in a dedicated container', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'openbot-xvfb-test-'))
  const lockPath = join(directory, 'display.lock')
  const socketPath = join(directory, 'display.socket')
  context.after(() => rm(directory, { recursive: true, force: true }))
  await writeFile(lockPath, `${process.pid}\n`)
  await writeFile(socketPath, 'stale socket')

  assert.equal(await displayIsOccupied(2, 'Xvfb', true, {
    lock: lockPath,
    socket: socketPath,
  }), false)
  await assert.rejects(access(lockPath), { code: 'ENOENT' })
  await assert.rejects(access(socketPath), { code: 'ENOENT' })
})

test('preserves X lock files outside a dedicated container', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'openbot-xvfb-test-'))
  const lockPath = join(directory, 'display.lock')
  const socketPath = join(directory, 'display.socket')
  context.after(() => rm(directory, { recursive: true, force: true }))
  await writeFile(lockPath, 'invalid\n')

  assert.equal(await displayIsOccupied(2, 'Xvfb', false, {
    lock: lockPath,
    socket: socketPath,
  }), true)
  await access(lockPath)
})
