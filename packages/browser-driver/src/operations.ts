import type { BrowserContext, ElementHandle, Page } from 'playwright-core'
import type {
  BrowserOperationRequest,
  ClickRequest,
  CdpRequest,
} from './contract.js'
import { SNAPSHOT_FUNCTION } from './snapshot.js'
import type { BrowserViewState } from './state.js'
import { BrowserStateStore } from './state.js'

export const ACTION_TIMEOUT_MS = 10_000
export const NAVIGATE_TIMEOUT_MS = 25_000

export type OperationResult = {
  page?: Page
  viewId?: string
  summary: string
  data?: string
  fullPage?: boolean
}

type OperationEnvironment = {
  request: BrowserOperationRequest
  context: BrowserContext
  state: BrowserViewState
  stateStore: BrowserStateStore
  sleep(milliseconds: number): Promise<void>
}

async function targetIdOf(context: BrowserContext, page: Page) {
  const session = await context.newCDPSession(page)
  try {
    const information = await session.send('Target.getTargetInfo')
    return information.targetInfo.targetId
  } finally {
    await session.detach().catch(() => {})
  }
}

async function pagesByTargetId(
  context: BrowserContext,
  sleep: (milliseconds: number) => Promise<void>,
) {
  const pages = new Map<string, Page>()
  for (const page of context.pages().filter((candidate) => !candidate.isClosed())) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        pages.set(await targetIdOf(context, page), page)
        break
      } catch {
        await sleep(150)
      }
    }
  }
  return pages
}

async function resolvePage(environment: OperationEnvironment) {
  const { request, context, state, stateStore, sleep } = environment
  const explicit = typeof request.viewId === 'string' && request.viewId.length > 0
  const viewId = explicit ? request.viewId! : (state.lastViewId ?? 'default')
  const mappedTarget = state.views[viewId]
  let byTarget = await pagesByTargetId(context, sleep)
  let page = mappedTarget === undefined ? undefined : byTarget.get(mappedTarget)
  if (page === undefined && mappedTarget !== undefined) {
    const deadline = Date.now() + 5_000
    while (page === undefined && Date.now() < deadline) {
      await sleep(400)
      byTarget = await pagesByTargetId(context, sleep)
      page = byTarget.get(mappedTarget)
    }
  }
  if (page === undefined && mappedTarget !== undefined) {
    const lastUrl = state.urls[viewId]
    if (lastUrl && lastUrl !== 'about:blank') {
      await stateStore.withClaimLock(request.display, async () => {
        const persisted = stateStore.load(request.display)
        const claimed = new Set([...Object.values(state.views), ...Object.values(persisted.views)])
        for (const [candidateId, candidate] of byTarget) {
          if (candidate.url() === lastUrl && !claimed.has(candidateId)) {
            page = candidate
            state.views[viewId] = candidateId
            stateStore.save(request.display, { views: { [viewId]: candidateId }, urls: {} })
            break
          }
        }
      })
    }
  }
  if (page === undefined && !explicit && byTarget.size > 0) page = [...byTarget.values()].at(-1)
  if (page === undefined) {
    page = await context.newPage()
    const lastUrl = state.urls[viewId]
    if (lastUrl && lastUrl !== 'about:blank') {
      await page.goto(lastUrl, { waitUntil: 'domcontentloaded', timeout: NAVIGATE_TIMEOUT_MS })
      await page.waitForLoadState('load', { timeout: 5_000 }).catch(() => {})
    }
  }
  state.views[viewId] = await targetIdOf(context, page)
  state.lastViewId = viewId
  page.setDefaultTimeout(ACTION_TIMEOUT_MS)
  return { page, viewId }
}

async function refHandle(page: Page, ref: string): Promise<ElementHandle<HTMLElement>> {
  const handle = await page.evaluateHandle((requestedRef) => {
    const refs = (globalThis as typeof globalThis & {
      __openbotBrowserRefs?: Map<string, Element>
    }).__openbotBrowserRefs
    return refs instanceof Map ? refs.get(requestedRef) : undefined
  }, ref)
  const element = handle.asElement() as ElementHandle<HTMLElement> | null
  if (element === null) {
    await handle.dispose()
    throw new Error(
      `Unknown or stale ref ${JSON.stringify(ref)}. Take a fresh browser_snapshot and use a ref from it.`,
    )
  }
  return element
}

function clickOptionsFor(request: ClickRequest) {
  const options: Parameters<ElementHandle<HTMLElement>['click']>[0] = {
    timeout: ACTION_TIMEOUT_MS,
  }
  if (request.button === 'right' || request.button === 'middle') options.button = request.button
  if (request.modifiers && request.modifiers.length > 0) options.modifiers = request.modifiers
  if (typeof request.holdDurationMs === 'number' && request.holdDurationMs > 0) {
    options.delay = Math.min(request.holdDurationMs, 5_000)
  }
  if (request.doubleClick === true) options.clickCount = 2
  return options
}

export async function executeOperation(environment: OperationEnvironment): Promise<OperationResult> {
  const { request, context, state, sleep } = environment
  switch (request.op) {
    case 'navigate': {
      if (request.newTab === true) {
        const page = await context.newPage()
        const viewId = request.viewId?.length ? request.viewId : `tab-${String(Date.now())}`
        state.views[viewId] = await targetIdOf(context, page)
        state.lastViewId = viewId
        page.setDefaultTimeout(ACTION_TIMEOUT_MS)
        await page.goto(request.url, { waitUntil: 'domcontentloaded', timeout: NAVIGATE_TIMEOUT_MS })
        await page.waitForLoadState('load', { timeout: 5_000 }).catch(() => {})
        return { page, viewId, summary: `Opened ${request.url} in a new tab` }
      }
      const { page, viewId } = await resolvePage(environment)
      await page.goto(request.url, { waitUntil: 'domcontentloaded', timeout: NAVIGATE_TIMEOUT_MS })
      await page.waitForLoadState('load', { timeout: 5_000 }).catch(() => {})
      return { page, viewId, summary: `Navigated to ${request.url}` }
    }
    case 'snapshot': {
      const { page, viewId } = await resolvePage(environment)
      const result = await page.evaluate(SNAPSHOT_FUNCTION, {
        interactive: request.interactive === true,
        maxDepth: typeof request.maxDepth === 'number' ? request.maxDepth : 20,
        ...(request.selector?.length && { selector: request.selector }),
      })
      return {
        page,
        viewId,
        summary: `Captured page snapshot (${String(result.refCount)} interactive refs)`,
        data: result.lines.join('\n'),
      }
    }
    case 'click': {
      const { page, viewId } = await resolvePage(environment)
      const element = await refHandle(page, request.ref)
      const options = clickOptionsFor(request)
      if (typeof request.offsetX === 'number' || typeof request.offsetY === 'number') {
        const box = await element.boundingBox()
        if (box !== null) {
          options.position = {
            x: box.width / 2 + (request.offsetX ?? 0),
            y: box.height / 2 + (request.offsetY ?? 0),
          }
        }
      }
      await element.click(options)
      await page.waitForLoadState('domcontentloaded', { timeout: 3_000 }).catch(() => {})
      return { page, viewId, summary: `Clicked ${request.element ?? request.ref}` }
    }
    case 'mouse_click_xy': {
      const { page, viewId } = await resolvePage(environment)
      await page.mouse.click(request.x, request.y, {
        button:
          request.button === 'right' || request.button === 'middle' ? request.button : 'left',
      })
      await page.waitForLoadState('domcontentloaded', { timeout: 3_000 }).catch(() => {})
      return { page, viewId, summary: `Clicked at (${String(request.x)}, ${String(request.y)})` }
    }
    case 'type': {
      const { page, viewId } = await resolvePage(environment)
      const element = await refHandle(page, request.ref)
      await element.click({ timeout: ACTION_TIMEOUT_MS })
      if (request.clear === true) await element.fill('').catch(() => {})
      await page.keyboard.type(request.text, { delay: request.slowly === true ? 40 : 0 })
      if (request.submit === true) {
        await page.keyboard.press('Enter')
        await page.waitForLoadState('domcontentloaded', { timeout: 5_000 }).catch(() => {})
      }
      return { page, viewId, summary: `Typed into ${request.element ?? request.ref}` }
    }
    case 'fill': {
      const { page, viewId } = await resolvePage(environment)
      const element = await refHandle(page, request.ref)
      await element.fill(request.value)
      return { page, viewId, summary: `Filled ${request.element ?? request.ref}` }
    }
    case 'select_option': {
      const { page, viewId } = await resolvePage(environment)
      const element = await refHandle(page, request.ref)
      let selected: string[]
      try {
        selected = await element.selectOption(request.values)
      } catch {
        selected = await element.selectOption(request.values.map((label) => ({ label })))
      }
      return {
        page,
        viewId,
        summary: `Selected ${JSON.stringify(selected)} in ${request.element ?? request.ref}`,
      }
    }
    case 'press_key': {
      const { page, viewId } = await resolvePage(environment)
      await page.keyboard.press(request.key)
      await page.waitForLoadState('domcontentloaded', { timeout: 3_000 }).catch(() => {})
      return { page, viewId, summary: `Pressed ${request.key}` }
    }
    case 'scroll': {
      const { page, viewId } = await resolvePage(environment)
      if (request.ref?.length) {
        const element = await refHandle(page, request.ref)
        await element.scrollIntoViewIfNeeded()
        return { page, viewId, summary: `Scrolled ${request.element ?? request.ref} into view` }
      }
      const amount = typeof request.amount === 'number' && request.amount > 0 ? request.amount : 300
      let deltaX = request.deltaX ?? 0
      let deltaY = request.deltaY ?? 0
      if (deltaX === 0 && deltaY === 0) {
        const direction = request.direction ?? 'down'
        if (direction === 'up') deltaY = -amount
        else if (direction === 'down') deltaY = amount
        else if (direction === 'left') deltaX = -amount
        else deltaX = amount
      }
      await page.mouse.wheel(deltaX, deltaY)
      await sleep(200)
      return { page, viewId, summary: `Scrolled by (${String(deltaX)}, ${String(deltaY)})` }
    }
    case 'tabs': {
      const pages = context.pages().filter((page) => !page.isClosed())
      if (request.action === 'list') {
        const entries = []
        for (let index = 0; index < pages.length; index += 1) {
          entries.push({
            index,
            url: pages[index]!.url(),
            title: await pages[index]!.title().catch(() => ''),
          })
        }
        return {
          summary: `Listed ${String(pages.length)} tab(s)`,
          data: JSON.stringify(entries, null, 1),
        }
      }
      if (request.action === 'new') {
        const page = await context.newPage()
        const viewId = `tab-${String(Date.now())}`
        state.views[viewId] = await targetIdOf(context, page)
        state.lastViewId = viewId
        return { page, viewId, summary: 'Opened a new tab' }
      }
      let page: Page | undefined
      if (typeof request.index === 'number') {
        page = pages[request.index]
        if (page === undefined) {
          throw new Error(`No tab at index ${String(request.index)} (${String(pages.length)} open)`)
        }
      } else if (request.action === 'close') {
        const requestedViewId = request.viewId?.length ? request.viewId : state.lastViewId
        const currentTarget = requestedViewId ? state.views[requestedViewId] : undefined
        if (currentTarget) {
          for (const candidate of pages) {
            try {
              if ((await targetIdOf(context, candidate)) === currentTarget) {
                page = candidate
                break
              }
            } catch {
              // Continue through pages whose targets are changing.
            }
          }
        }
        if (page === undefined) {
          throw new Error('No current tab to close; pass an index from browser_tabs list.')
        }
      } else {
        throw new Error(`Tab index is required for ${JSON.stringify(request.action)}.`)
      }
      if (request.action === 'select') {
        await page.bringToFront().catch(() => {})
        const targetId = await targetIdOf(context, page)
        let viewId = Object.keys(state.views).find((key) => state.views[key] === targetId)
        if (viewId === undefined) {
          viewId = `tab-${String(Date.now())}`
          state.views[viewId] = targetId
        }
        state.lastViewId = viewId
        return { page, viewId, summary: `Selected tab ${String(request.index)}` }
      }
      const targetId = await targetIdOf(context, page).catch(() => undefined)
      const closedUrl = page.url()
      await page.close()
      if (targetId !== undefined) {
        state.deletedViews ??= []
        for (const key of Object.keys(state.views)) {
          if (state.views[key] === targetId) {
            delete state.views[key]
            state.deletedViews.push(key)
            if (state.lastViewId === key) state.lastViewId = undefined
          }
        }
      }
      return { summary: `Closed tab (${closedUrl})` }
    }
    case 'screenshot': {
      const { page, viewId } = await resolvePage(environment)
      return {
        page,
        viewId,
        summary: 'Took a screenshot',
        fullPage: request.fullPage === true,
      }
    }
    case 'drag': {
      const { page, viewId } = await resolvePage(environment)
      const source = await refHandle(page, request.sourceRef)
      await source.scrollIntoViewIfNeeded()
      const sourceBox = await source.boundingBox()
      if (sourceBox === null) throw new Error('The drag source has no visible bounding box.')
      let targetX: number
      let targetY: number
      if (request.targetRef?.length) {
        const target = await refHandle(page, request.targetRef)
        const targetBox = await target.boundingBox()
        if (targetBox === null) throw new Error('The drag target has no visible bounding box.')
        targetX = targetBox.x + targetBox.width / 2
        targetY = targetBox.y + targetBox.height / 2
      } else if (typeof request.targetX === 'number' && typeof request.targetY === 'number') {
        targetX = request.targetX
        targetY = request.targetY
      } else {
        throw new Error('drag needs targetRef or targetX/targetY.')
      }
      const startX = sourceBox.x + sourceBox.width / 2
      const startY = sourceBox.y + sourceBox.height / 2
      await page.mouse.move(startX, startY)
      await page.mouse.down()
      for (let step = 1; step <= 12; step += 1) {
        await page.mouse.move(
          startX + ((targetX - startX) * step) / 12,
          startY + ((targetY - startY) * step) / 12,
        )
      }
      await page.mouse.up()
      return {
        page,
        viewId,
        summary: `Dragged ${request.sourceRef} to (${String(Math.round(targetX))}, ${String(Math.round(targetY))})`,
      }
    }
    case 'get_bounding_box': {
      const { page, viewId } = await resolvePage(environment)
      const element = await refHandle(page, request.ref)
      const box = await element.boundingBox()
      if (box === null) throw new Error('The element has no visible bounding box.')
      return {
        page,
        viewId,
        summary: `Bounding box for ${request.element ?? request.ref}`,
        data: JSON.stringify({
          x: Math.round(box.x),
          y: Math.round(box.y),
          width: Math.round(box.width),
          height: Math.round(box.height),
        }),
      }
    }
    case 'highlight': {
      const { page, viewId } = await resolvePage(environment)
      await page.bringToFront().catch(() => {})
      const element = await refHandle(page, request.ref)
      await element.scrollIntoViewIfNeeded()
      const durationMs = Math.min(
        typeof request.durationMs === 'number' && request.durationMs > 0 ? request.durationMs : 2_000,
        5_000,
      )
      await element.evaluate((target, milliseconds) => {
        const document = target.ownerDocument
        const rectangle = target.getBoundingClientRect()
        const overlay = document.createElement('div')
        overlay.style.cssText =
          'position:fixed;z-index:2147483647;pointer-events:none;border:3px solid #ff4d4f;' +
          'border-radius:4px;background:rgba(255,77,79,0.15);' +
          `left:${String(rectangle.left - 3)}px;top:${String(rectangle.top - 3)}px;` +
          `width:${String(rectangle.width)}px;height:${String(rectangle.height)}px;`
        document.body.appendChild(overlay)
        setTimeout(() => overlay.remove(), milliseconds)
      }, durationMs)
      await sleep(300)
      return {
        page,
        viewId,
        summary: `Highlighted ${request.element ?? request.ref} for ${String(durationMs)}ms`,
      }
    }
    case 'cdp':
      return executeCdp(request, environment)
  }
}

export const CDP_DENIED_PREFIXES = [
  'Browser.',
  'Target.',
  'Storage.',
  'SystemInfo.',
  'Security.',
  'Input.',
  'Tethering.',
  'Cast.',
] as const

export const CDP_DENIED_METHODS = [
  'Network.setCookie',
  'Network.setCookies',
  'Network.getCookies',
  'Network.getAllCookies',
  'Network.deleteCookies',
  'Network.clearBrowserCookies',
  'Network.clearBrowserCache',
] as const

export function assertCdpMethodAllowed(method: string) {
  if (
    method.length === 0 ||
    CDP_DENIED_PREFIXES.some((prefix) => method.startsWith(prefix)) ||
    CDP_DENIED_METHODS.some((denied) => denied === method)
  ) {
    throw new Error(
      `CDP method ${JSON.stringify(method)} is denied. Browser-wide, storage, cookie, cache, permission, target-management, and input commands are not allowed; use the dedicated browser tools instead.`,
    )
  }
}

async function executeCdp(request: CdpRequest, environment: OperationEnvironment) {
  assertCdpMethodAllowed(request.method)
  const { page, viewId } = await resolvePage(environment)
  const session = await environment.context.newCDPSession(page)
  try {
    const result = await (
      session as unknown as {
        send(method: string, params: Record<string, unknown>): Promise<unknown>
      }
    ).send(request.method, request.params ?? {})
    let serialized = JSON.stringify(result)
    const maximum = 20_000
    if (serialized.length > maximum) {
      serialized = `${serialized.slice(0, maximum)} ...(truncated ${String(serialized.length - maximum)} chars)`
    }
    return { page, viewId, summary: `Ran CDP ${request.method}`, data: serialized }
  } finally {
    await session.detach().catch(() => {})
  }
}
