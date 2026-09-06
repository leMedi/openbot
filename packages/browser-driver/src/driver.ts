import { mkdirSync } from 'node:fs'
import type { Browser, BrowserContext } from 'playwright-core'
import type {
  BrowserDriverOptions,
  BrowserOperationRequest,
  BrowserOperationResult,
  BrowserOperationSuccess,
} from './contract.js'
import { browserOperations } from './contract.js'
import { SharedCookieStore } from './cookies.js'
import {
  ensureChrome,
  reviveDiscardedTabs,
  systemLifecycleDependencies,
  type LifecycleDependencies,
} from './lifecycle.js'
import { executeOperation } from './operations.js'
import { BROWSER_STATE_DIRECTORY, BrowserStateStore } from './state.js'

const WATCHDOG_MS = 90_000
const ABORT_CLEANUP_MS = 5_000

export type BrowserDriverDependencies = {
  lifecycle: LifecycleDependencies
  connectOverCDP(endpoint: string, timeoutMs: number): Promise<Browser>
  disconnect(browser: Browser): Promise<void>
  stateStore: BrowserStateStore
  createCookieStore(path: string): SharedCookieStore
  watchdogMs: number
}

export async function runBrowserOperation(
  request: BrowserOperationRequest,
  options: BrowserDriverOptions = {},
): Promise<BrowserOperationResult> {
  return runBrowserOperationWithDependencies(request, options, systemDependencies())
}

export async function runBrowserOperationWithDependencies(
  request: BrowserOperationRequest,
  options: BrowserDriverOptions,
  dependencies: BrowserDriverDependencies,
): Promise<BrowserOperationResult> {
  try {
    validateRequest(request)
  } catch (error) {
    return { ok: false, error: errorMessage(error), code: 'invalid_request' }
  }

  const controller = new AbortController()
  let timedOut = false
  const watchdog = setTimeout(() => {
    timedOut = true
    controller.abort(new Error(`Browser driver timed out after ${String(dependencies.watchdogMs / 1_000)}s`))
  }, dependencies.watchdogMs)
  const cancel = () => controller.abort(options.signal?.reason ?? new Error('Browser operation was cancelled'))
  if (options.signal?.aborted) cancel()
  else options.signal?.addEventListener('abort', cancel, { once: true })

  let abortCleanup: Promise<void> | undefined
  const execution = execute(
    request,
    options,
    dependencies,
    controller.signal,
    (cleanup) => {
      abortCleanup = cleanup
    },
  )
  const aborted = new Promise<never>((_, reject) => {
    if (controller.signal.aborted) reject(controller.signal.reason)
    else controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true })
  })
  try {
    return await Promise.race([execution, aborted])
  } catch (error) {
    return {
      ok: false,
      error: timedOut ? `Browser driver timed out after ${String(dependencies.watchdogMs / 1_000)}s` : errorMessage(error),
      code: timedOut ? 'timeout' : options.signal?.aborted ? 'cancelled' : 'driver_failure',
    }
  } finally {
    clearTimeout(watchdog)
    options.signal?.removeEventListener('abort', cancel)
    if (abortCleanup) {
      await Promise.race([
        abortCleanup.catch(() => {}),
        new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, ABORT_CLEANUP_MS)
          timer.unref()
        }),
      ])
    }
    void execution.catch(() => {})
  }
}

async function execute(
  request: BrowserOperationRequest,
  options: BrowserDriverOptions,
  dependencies: BrowserDriverDependencies,
  signal: AbortSignal,
  onAbortCleanup: (cleanup: Promise<void>) => void,
): Promise<BrowserOperationSuccess> {
  await ensureChrome(request.cdpPort, request.display, dependencies.lifecycle, signal)
  await reviveDiscardedTabs(request.cdpPort, dependencies.lifecycle, signal)
  const endpoint = `http://127.0.0.1:${String(request.cdpPort)}`
  let browser: Browser | undefined
  let connectFailure: unknown
  for (let attempt = 0; attempt < 3; attempt += 1) {
    throwIfAborted(signal)
    try {
      browser = await dependencies.connectOverCDP(endpoint, 10_000)
      break
    } catch (error) {
      connectFailure = error
      if (attempt < 2) await dependencies.lifecycle.sleep(500)
    }
  }
  if (!browser) throw connectFailure ?? new Error('Could not connect to Chrome over CDP')

  let disconnecting: Promise<void> | undefined
  const disconnect = () => {
    disconnecting ??= dependencies.disconnect(browser!).catch(() => {})
    return disconnecting
  }
  const abort = () => onAbortCleanup(disconnect())
  signal.addEventListener('abort', abort, { once: true })
  let context: BrowserContext | undefined
  let cookieStore: SharedCookieStore | undefined
  let cookieBaseline: Awaited<ReturnType<SharedCookieStore['importInto']>> | undefined
  let operationFailure: unknown
  let output: BrowserOperationSuccess | undefined
  try {
    throwIfAborted(signal)
    context = browser.contexts()[0] ?? await browser.newContext()
    if (options.sharedCookiesPath !== undefined) {
      cookieStore = dependencies.createCookieStore(options.sharedCookiesPath)
      cookieBaseline = await cookieStore.importInto(context)
    }

    const state = dependencies.stateStore.load(request.display)
    const loadedViews = { ...state.views }
    const loadedUrls = { ...state.urls }
    const loadedLastViewId = state.lastViewId
    const result = await executeOperation({
      request,
      context,
      state,
      stateStore: dependencies.stateStore,
      sleep: dependencies.lifecycle.sleep,
    })
    if (result.viewId !== undefined && result.page !== undefined) {
      state.urls[result.viewId] = result.page.url()
    }
    const dirtyViews = Object.fromEntries(
      Object.entries(state.views).filter(([key, value]) => value !== loadedViews[key]),
    )
    const dirtyUrls = Object.fromEntries(
      Object.entries(state.urls).filter(([key, value]) => value !== loadedUrls[key]),
    )
    dependencies.stateStore.save(request.display, {
      views: dirtyViews,
      urls: dirtyUrls,
      deletedViews: state.deletedViews,
      ...(state.lastViewId !== loadedLastViewId && { lastViewId: state.lastViewId }),
    })

    output = { ok: true, summary: result.summary }
    if (result.data !== undefined) output.data = result.data
    if (result.viewId !== undefined) output.viewId = result.viewId
    if (result.page !== undefined) {
      output.url = result.page.url()
      output.title = await result.page.title().catch(() => '')
      if (request.screenshotPath?.length) {
        mkdirSync(BROWSER_STATE_DIRECTORY, { recursive: true })
        await result.page
          .screenshot({
            path: request.screenshotPath,
            timeout: 8_000,
            fullPage: result.fullPage === true,
          })
          .then(() => {
            output!.screenshot = true
          })
          .catch(() => {})
      }
    }
  } catch (error) {
    operationFailure = error
  }

  if (context && cookieStore && cookieBaseline) {
    try {
      await cookieStore.exportFrom(context, cookieBaseline)
    } catch (error) {
      operationFailure ??= error
    }
  }
  signal.removeEventListener('abort', abort)
  await disconnect()
  if (operationFailure !== undefined) throw operationFailure
  return output!
}

function systemDependencies(): BrowserDriverDependencies {
  const lifecycle = systemLifecycleDependencies()
  return {
    lifecycle,
    connectOverCDP: async (endpoint, timeoutMs) => {
      const { chromium } = await import('playwright-core')
      return chromium.connectOverCDP(endpoint, { timeout: timeoutMs })
    },
    // A Browser created by connectOverCDP owns only its Playwright transport;
    // close() disconnects that transport and leaves the persistent Chrome alive.
    disconnect: async (browser) => browser.close(),
    stateStore: new BrowserStateStore(BROWSER_STATE_DIRECTORY, lifecycle.sleep),
    createCookieStore: (path) => new SharedCookieStore(path, lifecycle.sleep),
    watchdogMs: WATCHDOG_MS,
  }
}

function validateRequest(request: BrowserOperationRequest) {
  if (!request || typeof request !== 'object') throw new Error('Browser operation request is required')
  if (!Number.isSafeInteger(request.display) || request.display < 0 || request.display > 65_535) {
    throw new Error('display must be an integer between 0 and 65535')
  }
  if (!Number.isSafeInteger(request.cdpPort) || request.cdpPort < 1 || request.cdpPort > 65_535) {
    throw new Error('cdpPort must be an integer between 1 and 65535')
  }
  if (!browserOperations.includes(request.op)) throw new Error(`Unknown op: ${String(request.op)}`)
}

function throwIfAborted(signal: AbortSignal) {
  if (signal.aborted) throw signal.reason ?? new Error('Browser operation was cancelled')
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
