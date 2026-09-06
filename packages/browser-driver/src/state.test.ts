import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { BROWSER_STATE_DIRECTORY, BrowserStateStore } from './state.js'

test('uses the required per-display state path', () => {
  assert.equal(BROWSER_STATE_DIRECTORY, '/tmp/.browser')
  assert.equal(new BrowserStateStore().path(17), '/tmp/.browser/views-17.json')
})

test('dirty saves preserve mappings written by another driver call', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'openbot-browser-state-'))
  const store = new BrowserStateStore(directory, async () => {})
  try {
    store.save(7, { views: { first: 'target-1' }, urls: { first: 'https://one.test' }, lastViewId: 'first' })
    const stale = store.load(7)
    store.save(7, { views: { second: 'target-2' }, urls: { second: 'https://two.test' }, lastViewId: 'second' })
    store.save(7, {
      views: { first: 'target-1-new' },
      urls: { first: stale.urls.first! },
    })

    assert.deepEqual(store.load(7), {
      views: { first: 'target-1-new', second: 'target-2' },
      urls: { first: 'https://one.test', second: 'https://two.test' },
      lastViewId: 'second',
    })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('claim lock breaks locks stale for more than five seconds', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'openbot-browser-lock-'))
  const store = new BrowserStateStore(directory, async () => {})
  const lockPath = `${store.path(9)}.lock`
  try {
    await writeFile(lockPath, 'old-owner')
    const old = new Date(Date.now() - 6_000)
    await utimes(lockPath, old, old)
    const value = await store.withClaimLock(9, async () => 'claimed')
    assert.equal(value, 'claimed')
    await assert.rejects(readFile(lockPath))
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
