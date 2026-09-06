import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type { BrowserContext, Page } from 'playwright-core'
import { browserOperations, browserOperationSchemas } from './contract.js'
import {
  ACTION_TIMEOUT_MS,
  assertCdpMethodAllowed,
  CDP_DENIED_METHODS,
  CDP_DENIED_PREFIXES,
  executeOperation,
  NAVIGATE_TIMEOUT_MS,
} from './operations.js'
import { BrowserStateStore } from './state.js'

test('publishes schemas for all fifteen Grok operations', () => {
  assert.equal(browserOperations.length, 15)
  assert.deepEqual(new Set(browserOperations), new Set(Object.keys(browserOperationSchemas)))
})

test('uses the complete Grok CDP denylist', () => {
  assert.deepEqual(CDP_DENIED_PREFIXES, [
    'Browser.',
    'Target.',
    'Storage.',
    'SystemInfo.',
    'Security.',
    'Input.',
    'Tethering.',
    'Cast.',
  ])
  assert.deepEqual(CDP_DENIED_METHODS, [
    'Network.setCookie',
    'Network.setCookies',
    'Network.getCookies',
    'Network.getAllCookies',
    'Network.deleteCookies',
    'Network.clearBrowserCookies',
    'Network.clearBrowserCache',
  ])
  for (const method of [...CDP_DENIED_PREFIXES.map((prefix) => `${prefix}test`), ...CDP_DENIED_METHODS]) {
    assert.throws(() => assertCdpMethodAllowed(method), /is denied/)
  }
  assert.doesNotThrow(() => assertCdpMethodAllowed('Runtime.evaluate'))
})

test('navigates with the Grok action, navigation, and load-wait timeouts', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'openbot-browser-operation-'))
  const calls: Record<string, unknown>[] = []
  const page = {
    isClosed: () => false,
    url: () => 'https://example.test',
    setDefaultTimeout: (timeout: number) => calls.push({ defaultTimeout: timeout }),
    goto: async (url: string, options: unknown) => calls.push({ goto: url, options }),
    waitForLoadState: async (state: string, options: unknown) => calls.push({ loadState: state, options }),
  } as unknown as Page
  const context = {
    pages: () => [page],
    newCDPSession: async () => ({
      send: async () => ({ targetInfo: { targetId: 'target-1' } }),
      detach: async () => {},
    }),
  } as unknown as BrowserContext
  try {
    const result = await executeOperation({
      request: {
        op: 'navigate',
        url: 'https://example.test',
        display: 2,
        cdpPort: 9222,
      },
      context,
      state: { views: {}, urls: {} },
      stateStore: new BrowserStateStore(directory, async () => {}),
      sleep: async () => {},
    })
    assert.equal(result.summary, 'Navigated to https://example.test')
    assert.deepEqual(calls, [
      { defaultTimeout: ACTION_TIMEOUT_MS },
      {
        goto: 'https://example.test',
        options: { waitUntil: 'domcontentloaded', timeout: NAVIGATE_TIMEOUT_MS },
      },
      { loadState: 'load', options: { timeout: 5_000 } },
    ])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('closes the explicitly requested logical view instead of the global last view', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'openbot-browser-tab-close-'))
  const closed: string[] = []
  const first = {
    isClosed: () => false,
    url: () => 'https://first.test',
    close: async () => { closed.push('first') },
  } as unknown as Page
  const second = {
    isClosed: () => false,
    url: () => 'https://second.test',
    close: async () => { closed.push('second') },
  } as unknown as Page
  const targets = new Map<Page, string>([[first, 'target-1'], [second, 'target-2']])
  const context = {
    pages: () => [first, second],
    newCDPSession: async (page: Page) => ({
      send: async () => ({ targetInfo: { targetId: targets.get(page) } }),
      detach: async () => {},
    }),
  } as unknown as BrowserContext
  try {
    await executeOperation({
      request: {
        op: 'tabs',
        action: 'close',
        viewId: 'requested',
        display: 2,
        cdpPort: 9222,
      },
      context,
      state: {
        views: { other: 'target-1', requested: 'target-2' },
        urls: {},
        lastViewId: 'other',
      },
      stateStore: new BrowserStateStore(directory, async () => {}),
      sleep: async () => {},
    })
    assert.deepEqual(closed, ['second'])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
