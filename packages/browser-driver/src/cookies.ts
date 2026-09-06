import {
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname } from 'node:path'
import type { BrowserContext, Cookie } from 'playwright-core'

type SetCookieParam = Parameters<BrowserContext['addCookies']>[0][number]

type CanonicalCookieFile = {
  version: 1
  cookies: SetCookieParam[]
  deleted?: CookieDeletion[]
}

type CookieDeletion = Pick<SetCookieParam, 'name'> & {
  domain?: string
  path?: string
}

export type CookieBaseline = Map<string, SetCookieParam>

export class SharedCookieStore {
  constructor(
    private readonly path: string,
    private readonly sleep: (milliseconds: number) => Promise<void> = (milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)),
  ) {
    if (!path.startsWith('/')) throw new Error('sharedCookiesPath must be an absolute path')
  }

  async importInto(context: BrowserContext): Promise<CookieBaseline> {
    const { cookies, deleted } = this.read()
    for (const cookie of deleted) {
      await context.clearCookies({
        name: cookie.name,
        ...(cookie.domain && { domain: cookie.domain }),
        ...(cookie.path && { path: cookie.path }),
      })
    }
    if (cookies.length > 0) await context.addCookies(cookies)
    return mapCookies(cookies)
  }

  async exportFrom(context: BrowserContext, baseline: CookieBaseline): Promise<void> {
    const profileCookies = (await context.cookies()).map(cookieForStorage)
    const profile = mapCookies(profileCookies)
    const dirtyKeys = new Set([...baseline.keys(), ...profile.keys()])
    for (const key of [...dirtyKeys]) {
      if (sameCookie(baseline.get(key), profile.get(key))) dirtyKeys.delete(key)
    }
    if (dirtyKeys.size === 0) return

    await this.withLock(async () => {
      const current = this.read()
      const merged = mapCookies(current.cookies)
      const deleted = new Map(current.deleted.map((cookie) => [cookieKey(cookie), cookie]))
      for (const key of dirtyKeys) {
        const cookie = profile.get(key)
        if (cookie === undefined) {
          merged.delete(key)
          const previous = baseline.get(key)
          if (previous) deleted.set(key, deletionFor(previous))
        } else {
          merged.set(key, cookie)
          deleted.delete(key)
        }
      }
      this.write([...merged.values()], [...deleted.values()])
    })
  }

  private read(): { cookies: SetCookieParam[]; deleted: CookieDeletion[] } {
    let raw: string
    try {
      raw = readFileSync(this.path, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { cookies: [], deleted: [] }
      throw error
    }
    const parsed: unknown = JSON.parse(raw)
    if (!isObject(parsed) || parsed.version !== 1 || !Array.isArray(parsed.cookies)) {
      throw new Error('Shared cookie file has an invalid format')
    }
    return {
      cookies: parsed.cookies.map(parseCookie).filter((cookie) => cookie.expires === undefined || cookie.expires < 0 || cookie.expires > Date.now() / 1_000),
      deleted: Array.isArray(parsed.deleted) ? parsed.deleted.map(parseDeletion) : [],
    }
  }

  private write(cookies: SetCookieParam[], deleted: CookieDeletion[]) {
    const directory = dirname(this.path)
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    const temporaryPath = `${this.path}.${String(process.pid)}.${uniqueSuffix()}.tmp`
    const payload: CanonicalCookieFile = {
      version: 1,
      cookies,
      ...(deleted.length > 0 && { deleted }),
    }
    writeFileSync(temporaryPath, JSON.stringify(payload), { mode: 0o600, flag: 'wx' })
    renameSync(temporaryPath, this.path)
  }

  private async withLock(operation: () => Promise<void>) {
    const lockPath = `${this.path}.lock`
    const deadline = Date.now() + 3_000
    let locked = false
    while (!locked && Date.now() < deadline) {
      try {
        mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 })
        writeFileSync(lockPath, String(process.pid), { mode: 0o600, flag: 'wx' })
        locked = true
      } catch {
        try {
          if (Date.now() - statSync(lockPath).mtimeMs > 5_000) unlinkSync(lockPath)
        } catch {
          // Retry after the lock holder finishes.
        }
        await this.sleep(50)
      }
    }
    if (!locked) throw new Error('Timed out acquiring the shared cookie lock')
    try {
      await operation()
    } finally {
      try {
        unlinkSync(lockPath)
      } catch {
        // The stale-lock recovery path can remove it first.
      }
    }
  }
}

function parseCookie(value: unknown): SetCookieParam {
  if (!isObject(value) || typeof value.name !== 'string' || typeof value.value !== 'string') {
    throw new Error('Shared cookie file contains an invalid cookie')
  }
  const cookie: SetCookieParam = { name: value.name, value: value.value }
  if (typeof value.url === 'string') cookie.url = value.url
  if (typeof value.domain === 'string') cookie.domain = value.domain
  if (typeof value.path === 'string') cookie.path = value.path
  if (typeof value.expires === 'number') cookie.expires = value.expires
  if (typeof value.httpOnly === 'boolean') cookie.httpOnly = value.httpOnly
  if (typeof value.secure === 'boolean') cookie.secure = value.secure
  if (value.sameSite === 'Strict' || value.sameSite === 'Lax' || value.sameSite === 'None') {
    cookie.sameSite = value.sameSite
  }
  if (typeof value.partitionKey === 'string') cookie.partitionKey = value.partitionKey
  if (!cookie.url && (!cookie.domain || !cookie.path)) {
    throw new Error('Shared cookie must contain url or domain and path')
  }
  return cookie
}

function parseDeletion(value: unknown): CookieDeletion {
  if (!isObject(value) || typeof value.name !== 'string') {
    throw new Error('Shared cookie file contains an invalid deletion')
  }
  return {
    name: value.name,
    ...(typeof value.domain === 'string' && { domain: value.domain }),
    ...(typeof value.path === 'string' && { path: value.path }),
  }
}

function deletionFor(cookie: SetCookieParam): CookieDeletion {
  return {
    name: cookie.name,
    ...(cookie.domain && { domain: cookie.domain }),
    ...(cookie.path && { path: cookie.path }),
  }
}

function cookieForStorage(cookie: Cookie): SetCookieParam {
  return {
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain,
    path: cookie.path,
    expires: cookie.expires,
    httpOnly: cookie.httpOnly,
    secure: cookie.secure,
    sameSite: cookie.sameSite,
    ...(cookie.partitionKey !== undefined && { partitionKey: cookie.partitionKey }),
  }
}

function cookieKey(cookie: Pick<SetCookieParam, 'name'> & { domain?: string; url?: string; path?: string; partitionKey?: string }) {
  return `${cookie.name}\u0000${cookie.domain ?? cookie.url ?? ''}\u0000${cookie.path ?? ''}\u0000${cookie.partitionKey ?? ''}`
}

function mapCookies(cookies: SetCookieParam[]) {
  return new Map(cookies.map((cookie) => [cookieKey(cookie), cookie]))
}

function sameCookie(left: SetCookieParam | undefined, right: SetCookieParam | undefined) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

let suffix = 0
function uniqueSuffix() {
  suffix += 1
  return `${String(Date.now())}-${String(suffix)}`
}
