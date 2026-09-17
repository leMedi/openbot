import { useSyncExternalStore } from 'react'
import { storage } from './storage'

// Which OpenBot server this device talks to. The app has no accounts yet: a
// server is single-user, so the URL is the whole "session".
const KEY = 'server-url'

let current: string | null = storage.get<string>(KEY)
const listeners = new Set<() => void>()

function emit() {
  for (const listener of listeners) listener()
}

export function getServerUrl(): string | null {
  return current
}

export function setServerUrl(url: string | null) {
  current = url
  if (url) storage.set(KEY, url)
  else storage.remove(KEY)
  emit()
}

export function useServerUrl(): string | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getServerUrl,
    getServerUrl,
  )
}

/** Accepts "host", "host:3000", or a full URL; returns a normalized origin. */
export function normalizeServerUrl(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`
  try {
    const url = new URL(withScheme)
    return url.origin
  } catch {
    return null
  }
}
