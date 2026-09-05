import { createServerFn } from '@tanstack/react-start'
import { getDesktopMode as getConfiguredDesktopMode } from '@openbot/agent'
import { readInstalledVersion } from './version'

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

async function checkForUpdate(): Promise<UpdateStatus> {
  const installed = await readInstalledVersion()
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
  const command = process.env.OPENBOT_UPDATE_COMMAND || '/opt/openbot/current/update-debian.sh'
  const [{ access, constants }, { spawn }] = await Promise.all([
    import('node:fs/promises'),
    import('node:child_process'),
  ])
  try { await access(command, constants.X_OK) } catch { throw new Error('Automatic updates are not configured for this server') }
  const child = spawn(command, [], { detached: true, stdio: 'ignore' })
  await new Promise<void>((resolve, reject) => {
    child.once('spawn', resolve)
    child.once('error', reject)
  })
  child.unref()
  return { started: true }
})
