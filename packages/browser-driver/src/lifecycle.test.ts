import assert from 'node:assert/strict'
import test from 'node:test'
import type { CdpSocket, LifecycleDependencies } from './lifecycle.js'
import { ensureChrome, reviveDiscardedTabs } from './lifecycle.js'

test('checks CDP before launching and polls every 500ms after the launcher returns', async () => {
  let now = 0
  let checks = 0
  const events: string[] = []
  const dependencies: LifecycleDependencies = {
    now: () => now,
    fetch: async () => {
      checks += 1
      events.push(`check-${String(checks)}`)
      return new Response('', { status: checks === 3 ? 200 : 503 })
    },
    launchChrome: async (display) => {
      events.push(`launch-${String(display)}`)
    },
    sleep: async (milliseconds) => {
      events.push(`sleep-${String(milliseconds)}`)
      now += milliseconds
    },
    openCdpSocket: async () => undefined,
  }

  await ensureChrome(9222, 12, dependencies)
  assert.deepEqual(events, ['check-1', 'launch-12', 'check-2', 'sleep-500', 'check-3'])
})

test('revives all hung tabs under one deadline and restores the visible tab', async () => {
  let targetForSession = new Map<string, string>()
  let hungProbeCount = 0
  const sends: Array<{ method: string; params: Record<string, unknown>; timeout: number }> = []
  const socket: CdpSocket = {
    send: async (method, params = {}, _sessionId, timeout) => {
      sends.push({ method, params, timeout })
      if (method === 'Target.attachToTarget') {
        const target = String(params.targetId)
        const sessionId = `session-${target}-${String(sends.length)}`
        targetForSession.set(sessionId, target)
        return { result: { sessionId } }
      }
      if (method === 'Runtime.evaluate') {
        const target = targetForSession.get(String(_sessionId))
        if (target === 'hung' && hungProbeCount++ === 0) return undefined
        return { result: { result: { value: target === 'visible' ? 'visible' : 'hidden' } } }
      }
      return { result: {} }
    },
    close: () => {},
  }
  const dependencies: LifecycleDependencies = {
    now: Date.now,
    sleep: async () => {},
    launchChrome: async () => {},
    openCdpSocket: async () => socket,
    fetch: async (input) => {
      const url = String(input)
      if (url.endsWith('/json/list')) {
        return Response.json([
          { id: 'visible', type: 'page' },
          { id: 'hung', type: 'page' },
        ])
      }
      return Response.json({ webSocketDebuggerUrl: 'ws://browser' })
    },
  }

  await reviveDiscardedTabs(9222, dependencies)
  assert.ok(
    sends.some(
      (entry) =>
        entry.method === 'Target.activateTarget' &&
        entry.params.targetId === 'hung' &&
        entry.timeout === 2_000,
    ),
  )
  assert.deepEqual(sends.at(-1), {
    method: 'Target.activateTarget',
    params: { targetId: 'visible' },
    timeout: 2_000,
  })
  assert.ok(sends.some((entry) => entry.method === 'Runtime.evaluate' && entry.timeout === 1_500))
})
