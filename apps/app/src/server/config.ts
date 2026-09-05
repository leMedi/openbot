import { createServerFn } from '@tanstack/react-start'
import { getDesktopMode as getConfiguredDesktopMode } from '@openbot/agent'

const repo = process.env.OPENBOT_GITHUB_REPO ?? 'leMedi/openbot'
const releasePattern = /^main-([0-9a-f]{12})$/
let cachedUpdate: UpdateStatus | null = null
let updatePromise: Promise<UpdateStatus> | null = null

type UpdateStatus = {
  installedVersion: string
  latestVersion: string | null
  updateAvailable: boolean
  checkedAt: string
  error?: string
}

async function installedVersion() {
  const [{ readFile }, { default: path }] = await Promise.all([
    import('node:fs/promises'),
    import('node:path'),
  ])
  for (const file of [
    path.join(process.cwd(), 'VERSION'),
    '/opt/openbot/current/VERSION',
  ]) {
    try { return (await readFile(file, 'utf8')).trim() } catch { /* try next */ }
  }
  return process.env.OPENBOT_VERSION ?? 'development'
}

async function checkForUpdate(): Promise<UpdateStatus> {
  const installed = await installedVersion()
  try {
    const response = await fetch(`https://api.github.com/repos/${repo}/releases?per_page=100`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'openbot-update-check' },
    })
    if (!response.ok) throw new Error(`GitHub returned ${response.status}`)
    const releases = await response.json() as Array<{ prerelease: boolean; tag_name: string; published_at: string; assets: Array<{ name: string }> }>
    const latest = releases
      .filter((release) => release.prerelease && releasePattern.test(release.tag_name) && release.assets.some((asset) => asset.name === 'openbot-debian-x64.tar.gz') && release.assets.some((asset) => asset.name === 'openbot-debian-x64.tar.gz.sha256'))
      .sort((a, b) => a.published_at.localeCompare(b.published_at))
      .at(-1)
    const latestVersion = latest?.tag_name ?? null
    const installedShort = installed.slice(0, 12).toLowerCase()
    return { installedVersion: installed, latestVersion, updateAvailable: !!latest && installedShort !== latestVersion?.slice(5), checkedAt: new Date().toISOString() }
  } catch (error) {
    return { installedVersion: installed, latestVersion: cachedUpdate?.latestVersion ?? null, updateAvailable: cachedUpdate?.updateAvailable ?? false, checkedAt: cachedUpdate?.checkedAt ?? new Date().toISOString(), error: error instanceof Error ? error.message : 'Update check failed' }
  }
}

function refreshUpdateCheck() {
  if (!updatePromise) updatePromise = checkForUpdate().then((result) => { cachedUpdate = result; return result }).finally(() => { updatePromise = null })
  return updatePromise
}

// Model selection is fixed by server configuration until the model providers
// and listing feature lands; clients display it read-only.
async function getDesktopStatus(): Promise<
  | { available: true; width: number; height: number; sessionId: string }
  | { available: false; error: string }
> {
  try {
    const { getDesktopDriverStatus } = await import('@openbot/agent')
    const display = await getDesktopDriverStatus()
    console.info('[desktop ready]', display)
    return { available: true as const, ...display }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Desktop driver is unavailable'
    console.warn('[desktop unavailable]', message)
    return { available: false as const, error: message }
  }
}

export const getServerConfig = createServerFn({ method: 'GET' }).handler(async () => ({
  model: process.env.OPENBOT_AI_MODEL ?? '',
  host: process.env.OPENBOT_PUBLIC_URL ?? `http://${process.env.HOST ?? '127.0.0.1'}:${process.env.PORT ?? '3000'}`,
  desktop: await getDesktopStatus(),
}))

export const getDesktopMode = createServerFn({ method: 'GET' }).handler(() =>
  getConfiguredDesktopMode(),
)

export const getServerUpdate = createServerFn({ method: 'GET' }).handler(async () => cachedUpdate ?? refreshUpdateCheck())

export const checkServerUpdate = createServerFn({ method: 'POST' }).handler(refreshUpdateCheck)

export const startServerUpdate = createServerFn({ method: 'POST' }).handler(async () => {
  const update = cachedUpdate ?? await refreshUpdateCheck()
  if (!update.updateAvailable) throw new Error('No update is available')
  const script = '/opt/openbot/current/update-debian.sh'
  const { access } = await import('node:fs/promises')
  try { await access(script) } catch { throw new Error('Automatic updates are only available on the Debian installation') }
  const { spawn } = await import('node:child_process')
  const child = spawn(script, [], { detached: true, stdio: 'ignore' })
  child.unref()
  return { started: true }
})
