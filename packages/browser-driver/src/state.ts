import {
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'

export const BROWSER_STATE_DIRECTORY = '/tmp/.browser'

export type BrowserViewState = {
  views: Record<string, string>
  urls: Record<string, string>
  lastViewId?: string
  deletedViews?: string[]
}

export type BrowserViewStateUpdate = Pick<BrowserViewState, 'views' | 'urls'> & {
  lastViewId?: string
  deletedViews?: string[]
}

export class BrowserStateStore {
  constructor(
    private readonly directory = BROWSER_STATE_DIRECTORY,
    private readonly sleep: (milliseconds: number) => Promise<void> = (milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)),
  ) {}

  path(display: number) {
    return join(this.directory, `views-${String(display)}.json`)
  }

  load(display: number): BrowserViewState {
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.path(display), 'utf8'))
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const value = parsed as Record<string, unknown>
        return {
          views: objectOfStrings(value.views),
          urls: objectOfStrings(value.urls),
          ...(typeof value.lastViewId === 'string' && { lastViewId: value.lastViewId }),
        }
      }
    } catch {
      // Missing or corrupt state is equivalent to no known views.
    }
    return { views: {}, urls: {} }
  }

  save(display: number, state: BrowserViewStateUpdate) {
    try {
      mkdirSync(this.directory, { recursive: true })
      const current = this.load(display)
      const views = { ...current.views, ...state.views }
      const urls = { ...current.urls, ...state.urls }
      for (const removed of state.deletedViews ?? []) {
        delete views[removed]
        delete urls[removed]
      }
      let lastViewId = state.lastViewId ?? current.lastViewId
      if (lastViewId !== undefined && (state.deletedViews ?? []).includes(lastViewId)) {
        lastViewId = undefined
      }
      const temporaryPath = `${this.path(display)}.${String(process.pid)}.${uniqueSuffix()}.tmp`
      writeFileSync(temporaryPath, JSON.stringify({ views, urls, lastViewId }))
      renameSync(temporaryPath, this.path(display))
    } catch {
      // View persistence is best effort, matching the source driver.
    }
  }

  async withClaimLock<T>(display: number, operation: () => Promise<T>): Promise<T> {
    const lockPath = `${this.path(display)}.lock`
    const deadline = Date.now() + 3_000
    let locked = false
    while (!locked && Date.now() < deadline) {
      try {
        mkdirSync(this.directory, { recursive: true })
        writeFileSync(lockPath, String(process.pid), { flag: 'wx' })
        locked = true
      } catch {
        try {
          if (Date.now() - statSync(lockPath).mtimeMs > 5_000) unlinkSync(lockPath)
        } catch {
          // The lock disappeared between attempts.
        }
        await this.sleep(50)
      }
    }
    if (!locked) throw new Error('Timed out acquiring the browser view lock')
    try {
      return await operation()
    } finally {
      if (locked) {
        try {
          unlinkSync(lockPath)
        } catch {
          // Another process may already have cleaned up a stale lock.
        }
      }
    }
  }
}

function objectOfStrings(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  )
}

let suffix = 0
function uniqueSuffix() {
  suffix += 1
  return `${String(Date.now())}-${String(suffix)}`
}
