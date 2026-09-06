import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type { Browser, BrowserContext, Cookie, Page } from 'playwright-core'
import { SharedCookieStore } from './cookies.js'
import type { BrowserDriverDependencies } from './driver.js'
import { runBrowserOperationWithDependencies } from './driver.js'
import type { LifecycleDependencies } from './lifecycle.js'
import { BrowserStateStore } from './state.js'

function cookie(value: string): Cookie {
  return {
    name: 'session',
    value,
    domain: '.example.test',
    path: '/',
    expires: -1,
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
  }
}

async function dependencies(
  context: BrowserContext,
  stateDirectory: string,
  overrides: Partial<BrowserDriverDependencies> = {},
) {
  const calls = { connect: [] as Array<{ endpoint: string; timeout: number }>, disconnect: 0 }
  const browser = {
    contexts: () => [context],
    close: async () => {},
  } as unknown as Browser
  const lifecycle: LifecycleDependencies = {
    now: Date.now,
    sleep: async () => {},
    launchChrome: async () => {},
    openCdpSocket: async () => undefined,
    fetch: async (input) =>
      String(input).endsWith('/json/list')
        ? Response.json([])
        : Response.json({ webSocketDebuggerUrl: 'ws://unused' }),
  }
  const value: BrowserDriverDependencies = {
    lifecycle,
    connectOverCDP: async (endpoint, timeout) => {
      calls.connect.push({ endpoint, timeout })
      return browser
    },
    disconnect: async () => {
      calls.disconnect += 1
    },
    stateStore: new BrowserStateStore(stateDirectory, lifecycle.sleep),
    createCookieStore: (path) => new SharedCookieStore(path, lifecycle.sleep),
    watchdogMs: 1_000,
    ...overrides,
  }
  return { calls, value }
}

test('runs one operation, syncs cookies internally, and disconnects CDP', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'openbot-browser-driver-'))
  const cookiePath = join(directory, 'cookies.json')
  const imported: unknown[] = []
  const context = {
    pages: () => [],
    addCookies: async (cookies: unknown[]) => imported.push(...cookies),
    cookies: async () => [cookie('changed-secret')],
  } as unknown as BrowserContext
  try {
    await writeFile(cookiePath, JSON.stringify({ version: 1, cookies: [cookie('initial-secret')] }))
    const fake = await dependencies(context, directory)
    const result = await runBrowserOperationWithDependencies(
      { op: 'tabs', action: 'list', display: 8, cdpPort: 9222 },
      { sharedCookiesPath: cookiePath },
      fake.value,
    )

    assert.deepEqual(fake.calls.connect, [{ endpoint: 'http://127.0.0.1:9222', timeout: 10_000 }])
    assert.equal(fake.calls.disconnect, 1)
    assert.equal((imported[0] as { value: string }).value, 'initial-secret')
    assert.equal(JSON.stringify(result).includes('secret'), false)
    assert.deepEqual(result, { ok: true, summary: 'Listed 0 tab(s)', data: '[]' })
    assert.equal((JSON.parse(await readFile(cookiePath, 'utf8')) as any).cookies[0].value, 'changed-secret')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('returns a watchdog timeout when a dependency does not settle', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'openbot-browser-watchdog-'))
  const context = { pages: () => [] } as unknown as BrowserContext
  try {
    const fake = await dependencies(context, directory, {
      connectOverCDP: async () => new Promise<Browser>(() => {}),
      watchdogMs: 10,
    })
    const result = await runBrowserOperationWithDependencies(
      { op: 'tabs', action: 'list', display: 1, cdpPort: 9222 },
      {},
      fake.value,
    )
    assert.deepEqual(result, {
      ok: false,
      error: 'Browser driver timed out after 0.01s',
      code: 'timeout',
    })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('retries transient CDP connection failures', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'openbot-browser-connect-retry-'))
  const context = { pages: () => [] } as unknown as BrowserContext
  let attempts = 0
  try {
    const fake = await dependencies(context, directory, {
      connectOverCDP: async () => {
        attempts += 1
        if (attempts < 3) throw new Error('transient CDP failure')
        return {
          contexts: () => [context],
          close: async () => {},
        } as unknown as Browser
      },
    })
    const result = await runBrowserOperationWithDependencies(
      { op: 'tabs', action: 'list', display: 1, cdpPort: 9222 },
      {},
      fake.value,
    )
    assert.equal(result.ok, true)
    assert.equal(attempts, 3)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('waits for CDP disconnect before returning a timeout', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'openbot-browser-abort-cleanup-'))
  const cookiePath = join(directory, 'cookies.json')
  let releaseDisconnect!: () => void
  const disconnectGate = new Promise<void>((resolve) => {
    releaseDisconnect = resolve
  })
  const context = {
    pages: () => [],
    addCookies: async () => {},
    cookies: async () => new Promise<Cookie[]>(() => {}),
  } as unknown as BrowserContext
  try {
    await writeFile(cookiePath, JSON.stringify({ version: 1, cookies: [] }))
    const fake = await dependencies(context, directory, {
      disconnect: async () => disconnectGate,
      watchdogMs: 10,
    })
    let settled = false
    const operation = runBrowserOperationWithDependencies(
      { op: 'tabs', action: 'list', display: 1, cdpPort: 9222 },
      { sharedCookiesPath: cookiePath },
      fake.value,
    ).finally(() => {
      settled = true
    })
    await new Promise((resolve) => setTimeout(resolve, 25))
    assert.equal(settled, false)
    releaseDisconnect()
    assert.deepEqual(await operation, {
      ok: false,
      error: 'Browser driver timed out after 0.01s',
      code: 'timeout',
    })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('captures requested page screenshots with an eight-second timeout', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'openbot-browser-screenshot-'))
  const screenshots: unknown[] = []
  const page = {
    isClosed: () => false,
    url: () => 'https://example.test',
    title: async () => 'Example',
    setDefaultTimeout: () => {},
    screenshot: async (options: unknown) => {
      screenshots.push(options)
    },
  } as unknown as Page
  const context = {
    pages: () => [page],
    newCDPSession: async () => ({
      send: async () => ({ targetInfo: { targetId: 'target-1' } }),
      detach: async () => {},
    }),
  } as unknown as BrowserContext
  try {
    const fake = await dependencies(context, directory)
    const screenshotPath = join(directory, 'page.png')
    const result = await runBrowserOperationWithDependencies(
      {
        op: 'screenshot',
        display: 3,
        cdpPort: 9222,
        screenshotPath,
        fullPage: true,
      },
      {},
      fake.value,
    )
    assert.deepEqual(screenshots, [{ path: screenshotPath, timeout: 8_000, fullPage: true }])
    assert.deepEqual(result, {
      ok: true,
      summary: 'Took a screenshot',
      viewId: 'default',
      url: 'https://example.test',
      title: 'Example',
      screenshot: true,
    })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
