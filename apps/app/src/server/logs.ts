import { format } from 'node:util'

// Captures everything the server process writes through `console` into a
// bounded in-memory ring so the settings dialog can show and download recent
// server output. The original console methods keep writing to stdout/stderr,
// so journald or Docker logs are unaffected. State lives on `globalThis` so
// the Vite dev server, the production bundle, and the Debian runtime wrapper
// share one buffer even when this module is instantiated more than once.

import type { ServerLogEntry, ServerLogLevel } from '@/lib/server-logs'

export type { ServerLogEntry, ServerLogLevel } from '@/lib/server-logs'

type LogStore = {
  entries: ServerLogEntry[]
  nextId: number
  listeners: Set<(entry: ServerLogEntry) => void>
  installed: boolean
}

export const SERVER_LOG_CAPACITY = 500

const storeKey = Symbol.for('openbot.server-logs')

function store(): LogStore {
  const globals = globalThis as typeof globalThis & { [storeKey]?: LogStore }
  return globals[storeKey] ??= { entries: [], nextId: 1, listeners: new Set(), installed: false }
}

export function appendServerLog(level: ServerLogLevel, message: string) {
  const state = store()
  const entry: ServerLogEntry = { id: state.nextId++, time: new Date().toISOString(), level, message }
  state.entries.push(entry)
  if (state.entries.length > SERVER_LOG_CAPACITY) state.entries.splice(0, state.entries.length - SERVER_LOG_CAPACITY)
  for (const listener of state.listeners) {
    try { listener(entry) } catch { /* A broken subscriber must not break logging. */ }
  }
  return entry
}

export function listServerLogs(afterId = 0) {
  return store().entries.filter((entry) => entry.id > afterId)
}

export function subscribeServerLogs(listener: (entry: ServerLogEntry) => void) {
  const { listeners } = store()
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

const consoleLevels: Array<[keyof Console & ('debug' | 'log' | 'info' | 'warn' | 'error'), ServerLogLevel]> = [
  ['debug', 'debug'],
  ['log', 'info'],
  ['info', 'info'],
  ['warn', 'warn'],
  ['error', 'error'],
]

export function installServerLogCapture() {
  const state = store()
  if (state.installed) return
  state.installed = true
  for (const [method, level] of consoleLevels) {
    const original = console[method].bind(console)
    console[method] = (...args: unknown[]) => {
      original(...args)
      appendServerLog(level, format(...args))
    }
  }
}
