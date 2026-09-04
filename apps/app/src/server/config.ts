import { createDesktopDriver } from '@openbot/agent'
import { createServerFn } from '@tanstack/react-start'

// Model selection is fixed by server configuration until the model providers
// and listing feature lands; clients display it read-only.
const desktopStatusPromise = (async (): Promise<
  | { available: true; width: number; height: number; sessionId: string }
  | { available: false; error: string }
> => {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 3_000)
  try {
    const display = await createDesktopDriver().getDisplay(controller.signal)
    console.info('[desktop ready]', display)
    return { available: true as const, ...display }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Desktop driver is unavailable'
    console.warn('[desktop unavailable]', message)
    return { available: false as const, error: message }
  } finally {
    clearTimeout(timeout)
  }
})()

export const getServerConfig = createServerFn({ method: 'GET' }).handler(async () => ({
  model: process.env.OPENBOT_AI_MODEL ?? '',
  desktop: await desktopStatusPromise,
}))
