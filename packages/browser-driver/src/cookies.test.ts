import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type { BrowserContext, Cookie } from 'playwright-core'
import { SharedCookieStore } from './cookies.js'

function cookie(name: string, value: string): Cookie {
  return {
    name,
    value,
    domain: '.example.test',
    path: '/',
    expires: -1,
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
  }
}

function context(returnedCookies: () => Cookie[]) {
  const imported: unknown[] = []
  const cleared: unknown[] = []
  return {
    imported,
    cleared,
    value: {
      addCookies: async (cookies: unknown[]) => {
        imported.push(...cookies)
      },
      clearCookies: async (filter: unknown) => {
        cleared.push(filter)
      },
      cookies: async () => returnedCookies(),
    } as unknown as BrowserContext,
  }
}

test('imports canonical cookies and dirty-merges profile changes atomically', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'openbot-browser-cookies-'))
  const path = join(directory, 'shared.json')
  const initial = cookie('session', 'old')
  const store = new SharedCookieStore(path, async () => {})
  const fake = context(() => [cookie('session', 'new')])
  try {
    await writeFile(path, JSON.stringify({ version: 1, cookies: [initial] }), { mode: 0o600 })
    const baseline = await store.importInto(fake.value)
    assert.equal((fake.imported[0] as { value: string }).value, 'old')

    await writeFile(
      path,
      JSON.stringify({ version: 1, cookies: [initial, cookie('concurrent', 'kept')] }),
      { mode: 0o600 },
    )
    await store.exportFrom(fake.value, baseline)

    const saved = JSON.parse(await readFile(path, 'utf8')) as {
      version: number
      cookies: Array<{ name: string; value: string }>
    }
    assert.equal(saved.version, 1)
    assert.deepEqual(
      Object.fromEntries(saved.cookies.map((entry) => [entry.name, entry.value])),
      { session: 'new', concurrent: 'kept' },
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('propagates cookie deletions to another persistent profile', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'openbot-browser-cookie-delete-'))
  const path = join(directory, 'shared.json')
  const initial = cookie('session', 'old')
  const store = new SharedCookieStore(path, async () => {})
  try {
    await writeFile(path, JSON.stringify({ version: 1, cookies: [initial] }), { mode: 0o600 })
    const deletingProfile = context(() => [])
    const baseline = await store.importInto(deletingProfile.value)
    await store.exportFrom(deletingProfile.value, baseline)

    const saved = JSON.parse(await readFile(path, 'utf8')) as {
      cookies: unknown[]
      deleted: unknown[]
    }
    assert.deepEqual(saved.cookies, [])
    assert.deepEqual(saved.deleted, [{ name: 'session', domain: '.example.test', path: '/' }])

    const staleProfile = context(() => [initial])
    await store.importInto(staleProfile.value)
    assert.deepEqual(staleProfile.cleared, [{
      name: 'session',
      domain: '.example.test',
      path: '/',
    }])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('requires a trusted absolute cookie path', () => {
  assert.throws(() => new SharedCookieStore('relative/cookies.json'), /absolute path/)
})
