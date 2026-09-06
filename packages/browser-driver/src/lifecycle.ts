import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'

export type CdpSocket = {
  send(
    method: string,
    params: Record<string, unknown> | undefined,
    sessionId: string | undefined,
    timeoutMs: number,
  ): Promise<Record<string, any> | undefined>
  close(): void
}

export type LifecycleDependencies = {
  fetch: typeof globalThis.fetch
  now(): number
  sleep(milliseconds: number): Promise<void>
  launchChrome(display: number, signal?: AbortSignal): Promise<void>
  openCdpSocket(url: string): Promise<CdpSocket | undefined>
}

export async function cdpAlive(
  port: number,
  dependencies: Pick<LifecycleDependencies, 'fetch'>,
  signal?: AbortSignal,
) {
  try {
    const response = await dependencies.fetch(`http://127.0.0.1:${String(port)}/json/version`, {
      signal: combinedSignal(signal, 1_500),
    })
    return response.ok
  } catch {
    return false
  }
}

export async function ensureChrome(
  port: number,
  display: number,
  dependencies: LifecycleDependencies,
  signal?: AbortSignal,
) {
  if (await cdpAlive(port, dependencies, signal)) return
  throwIfAborted(signal)
  await dependencies.launchChrome(display, signal)
  const deadline = dependencies.now() + 30_000
  while (dependencies.now() < deadline) {
    throwIfAborted(signal)
    if (await cdpAlive(port, dependencies, signal)) return
    await dependencies.sleep(500)
  }
  throw new Error(`The box browser's CDP endpoint did not come up on port ${String(port)}`)
}

export async function reviveDiscardedTabs(
  port: number,
  dependencies: LifecycleDependencies,
  signal?: AbortSignal,
) {
  let socket: CdpSocket | undefined
  try {
    const base = `http://127.0.0.1:${String(port)}`
    const listResponse = await dependencies.fetch(`${base}/json/list`, {
      signal: combinedSignal(signal, 1_500),
    })
    if (!listResponse.ok) return
    const list: unknown = await listResponse.json()
    if (!Array.isArray(list)) return
    const targets = list.filter(isPageTarget)
    if (targets.length === 0) return
    const versionResponse = await dependencies.fetch(`${base}/json/version`, {
      signal: combinedSignal(signal, 1_500),
    })
    if (!versionResponse.ok) return
    const version: unknown = await versionResponse.json()
    const wsUrl = isObject(version) ? version.webSocketDebuggerUrl : undefined
    if (typeof wsUrl !== 'string' || wsUrl.length === 0) return
    socket = await dependencies.openCdpSocket(wsUrl)
    if (socket === undefined) return

    const probe = async (targetId: string) => {
      const attached = await socket!.send(
        'Target.attachToTarget',
        { targetId, flatten: true },
        undefined,
        2_000,
      )
      const sessionId = attached?.result?.sessionId
      if (typeof sessionId !== 'string') return undefined
      const evaluated = await socket!.send(
        'Runtime.evaluate',
        { expression: 'document.visibilityState', returnByValue: true },
        sessionId,
        1_500,
      )
      void socket!.send('Target.detachFromTarget', { sessionId }, undefined, 1_000)
      return evaluated?.result?.result?.value as unknown
    }

    const states = await Promise.all(targets.map((target) => probe(target.id)))
    const hung = targets.filter((_, index) => states[index] === undefined)
    if (hung.length === 0) return
    const visible = targets.find((_, index) => states[index] === 'visible')

    // This is one overall 20-second budget, not a budget per discarded tab.
    const deadline = dependencies.now() + 20_000
    let remaining = hung.map((target) => target.id)
    while (remaining.length > 0 && dependencies.now() < deadline) {
      throwIfAborted(signal)
      await Promise.all(
        remaining.map((targetId) =>
          socket!.send('Target.activateTarget', { targetId }, undefined, 2_000),
        ),
      )
      const results = await Promise.all(remaining.map((targetId) => probe(targetId)))
      remaining = remaining.filter((_, index) => results[index] === undefined)
      if (remaining.length > 0) await dependencies.sleep(300)
    }
    if (visible !== undefined) {
      await socket.send('Target.activateTarget', { targetId: visible.id }, undefined, 2_000)
    }
  } catch (error) {
    if (signal?.aborted) throw error
    // Revival is best effort; connectOverCDP reports the authoritative failure.
  } finally {
    socket?.close()
  }
}

export function systemLifecycleDependencies(): LifecycleDependencies {
  return {
    fetch: globalThis.fetch,
    now: Date.now,
    sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    launchChrome: (display, signal) =>
      new Promise((resolve, reject) => {
        const child = spawn('box-chrome', ['--new-window'], {
          detached: true,
          env: { ...process.env, DISPLAY: `:${String(display)}` },
          stdio: 'ignore',
        })
        let settled = false
        const timer = setTimeout(() => finish(), 45_000)
        const abort = () => {
          if (child.pid) {
            try {
              process.kill(-child.pid, 'SIGKILL')
            } catch {
              // The launcher may have exited between the signal and cleanup.
            }
          }
          finish(signal?.reason ?? new Error('Browser launch was cancelled'))
        }
        function finish(error?: unknown) {
          if (settled) return
          settled = true
          clearTimeout(timer)
          signal?.removeEventListener('abort', abort)
          if (error) reject(error)
          else resolve()
        }
        if (signal?.aborted) abort()
        else signal?.addEventListener('abort', abort, { once: true })
        child.once('error', finish)
        child.once('exit', () => finish())
      }),
    openCdpSocket,
  }
}

export async function openCdpSocket(wsUrl: string): Promise<CdpSocket | undefined> {
  let WebSocketConstructor: any
  try {
    WebSocketConstructor = createRequire(import.meta.url)('playwright-core/lib/utilsBundle').ws
  } catch {
    return undefined
  }
  let socket: any
  try {
    socket = new WebSocketConstructor(wsUrl)
  } catch {
    return undefined
  }
  const opened = await new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), 3_000)
    socket.on('open', () => {
      clearTimeout(timer)
      resolve(true)
    })
    socket.on('error', () => {
      clearTimeout(timer)
      resolve(false)
    })
  })
  if (!opened) {
    try {
      socket.close()
    } catch {
      // Ignore socket cleanup failures.
    }
    return undefined
  }
  let nextId = 1
  const pending = new Map<number, (message: Record<string, any>) => void>()
  socket.on('message', (data: unknown) => {
    let message: Record<string, any>
    try {
      message = JSON.parse(String(data)) as Record<string, any>
    } catch {
      return
    }
    if (typeof message.id === 'number' && pending.has(message.id)) {
      pending.get(message.id)!(message)
      pending.delete(message.id)
    }
  })
  return {
    send: (method, params, sessionId, timeoutMs) =>
      new Promise((resolve) => {
        const id = nextId++
        const timer = setTimeout(() => {
          pending.delete(id)
          resolve(undefined)
        }, timeoutMs)
        pending.set(id, (message) => {
          clearTimeout(timer)
          resolve(message)
        })
        try {
          socket.send(JSON.stringify({ id, method, params: params ?? {}, ...(sessionId && { sessionId }) }))
        } catch {
          clearTimeout(timer)
          pending.delete(id)
          resolve(undefined)
        }
      }),
    close: () => {
      try {
        socket.close()
      } catch {
        // Ignore socket cleanup failures.
      }
    },
  }
}

function combinedSignal(signal: AbortSignal | undefined, timeoutMs: number) {
  const timeout = AbortSignal.timeout(timeoutMs)
  return signal ? AbortSignal.any([signal, timeout]) : timeout
}

function throwIfAborted(signal: AbortSignal | undefined) {
  if (signal?.aborted) throw signal.reason ?? new Error('Browser operation was cancelled')
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isPageTarget(value: unknown): value is { id: string; type: 'page' } {
  return isObject(value) && value.type === 'page' && typeof value.id === 'string'
}
