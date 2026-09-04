import { spawn } from 'node:child_process'

export type DesktopPoint = { x: number; y: number }
export type DesktopCursor = DesktopPoint

export type DesktopAction =
  | { action: 'screenshot' }
  | {
      action: 'click'
      x: number
      y: number
      button: 'left' | 'right' | 'middle'
      clickCount: number
      description?: string
    }
  | { action: 'move'; x: number; y: number }
  | {
      action: 'drag'
      button: 'left' | 'right' | 'middle'
      path: DesktopPoint[]
      description?: string
    }
  | { action: 'type'; text: string; description?: string }
  | { action: 'key'; key: string; description?: string }
  | {
      action: 'scroll'
      direction: 'up' | 'down' | 'left' | 'right'
      amount: number
      at?: DesktopPoint
    }
  | { action: 'wait'; durationMs: number }

export type DesktopDisplay = {
  width: number
  height: number
  /** Stable identity for the configured graphical session. */
  sessionId: string
}

export type DesktopScreenshot = {
  dataBase64: string
  mediaType: 'image/png' | 'image/jpeg' | 'image/webp'
  width: number
  height: number
  cursor?: DesktopCursor
  /** Optional driver-native screen identity; OpenBot hashes the image otherwise. */
  stateId?: string
}

export type DesktopDriverExecution = {
  screenshot?: DesktopScreenshot
  cursor?: DesktopCursor
}

export type DesktopFailureCode =
  | 'desktop_unavailable'
  | 'timeout'
  | 'cancelled'
  | 'driver_failure'

export class DesktopDriverError extends Error {
  constructor(
    readonly code: DesktopFailureCode,
    message: string,
  ) {
    super(message)
    this.name = 'DesktopDriverError'
  }
}

/**
 * The only boundary allowed to inspect or control the server's configured
 * graphical desktop. Implementations are local to the OpenBot server.
 */
export interface DesktopDriver {
  getDisplay(signal?: AbortSignal): Promise<DesktopDisplay>
  captureScreenshot(signal?: AbortSignal): Promise<DesktopScreenshot>
  execute(actions: readonly DesktopAction[], signal?: AbortSignal): Promise<DesktopDriverExecution>
}

class UnavailableDesktopDriver implements DesktopDriver {
  constructor(
    private readonly message =
      'Computer Use is unavailable because no local desktop driver is configured',
  ) {}

  private unavailable(): never {
    throw new DesktopDriverError('desktop_unavailable', this.message)
  }

  async getDisplay(): Promise<DesktopDisplay> {
    return this.unavailable()
  }

  async captureScreenshot(): Promise<DesktopScreenshot> {
    return this.unavailable()
  }

  async execute(): Promise<DesktopDriverExecution> {
    return this.unavailable()
  }
}

type DriverResponse = {
  ok?: unknown
  status?: unknown
  error?: unknown
  display?: unknown
  screenshot?: unknown
  cursor?: unknown
}

const MAX_DRIVER_OUTPUT_BYTES = 35 * 1024 * 1024

function failureCode(value: unknown): DesktopFailureCode {
  if (value === 'desktop_unavailable' || value === 'timeout' || value === 'cancelled') {
    return value
  }
  return 'driver_failure'
}

function parseDisplay(value: unknown): DesktopDisplay {
  if (!value || typeof value !== 'object') {
    throw new DesktopDriverError('driver_failure', 'Desktop driver returned no display')
  }
  const display = value as Record<string, unknown>
  if (
    !Number.isInteger(display.width) ||
    !Number.isInteger(display.height) ||
    Number(display.width) <= 0 ||
    Number(display.height) <= 0 ||
    typeof display.sessionId !== 'string' ||
    !display.sessionId
  ) {
    throw new DesktopDriverError('driver_failure', 'Desktop driver returned an invalid display')
  }
  return {
    width: Number(display.width),
    height: Number(display.height),
    sessionId: display.sessionId,
  }
}

function parseCursor(value: unknown): DesktopCursor | undefined {
  if (!value || typeof value !== 'object') return undefined
  const cursor = value as Record<string, unknown>
  if (!Number.isInteger(cursor.x) || !Number.isInteger(cursor.y)) return undefined
  return { x: Number(cursor.x), y: Number(cursor.y) }
}

function parseScreenshot(value: unknown): DesktopScreenshot {
  if (!value || typeof value !== 'object') {
    throw new DesktopDriverError('driver_failure', 'Desktop driver returned no screenshot')
  }
  const screenshot = value as Record<string, unknown>
  const mediaType = screenshot.mediaType
  if (
    typeof screenshot.dataBase64 !== 'string' ||
    !['image/png', 'image/jpeg', 'image/webp'].includes(String(mediaType)) ||
    !Number.isInteger(screenshot.width) ||
    !Number.isInteger(screenshot.height) ||
    Number(screenshot.width) <= 0 ||
    Number(screenshot.height) <= 0
  ) {
    throw new DesktopDriverError('driver_failure', 'Desktop driver returned an invalid screenshot')
  }
  return {
    dataBase64: screenshot.dataBase64,
    mediaType: mediaType as DesktopScreenshot['mediaType'],
    width: Number(screenshot.width),
    height: Number(screenshot.height),
    ...(parseCursor(screenshot.cursor) && { cursor: parseCursor(screenshot.cursor) }),
    ...(typeof screenshot.stateId === 'string' && screenshot.stateId
      ? { stateId: screenshot.stateId }
      : {}),
  }
}

/**
 * Local executable protocol. The configured executable receives one JSON
 * request on stdin and returns one JSON response on stdout. It is launched
 * directly (never through a shell), so model input cannot become a command.
 */
export class ProcessDesktopDriver implements DesktopDriver {
  constructor(
    private readonly executable: string,
    private readonly args: readonly string[] = [],
  ) {}

  private invoke(request: unknown, signal?: AbortSignal): Promise<DriverResponse> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new DesktopDriverError('cancelled', 'Desktop operation was cancelled'))
        return
      }
      const child = spawn(this.executable, [...this.args], {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      })
      let stdout = ''
      let stderr = ''
      let forceKill: NodeJS.Timeout | undefined
      const abort = () => {
        child.kill('SIGTERM')
        forceKill = setTimeout(() => child.kill('SIGKILL'), 500)
        forceKill.unref()
      }
      signal?.addEventListener('abort', abort, { once: true })
      child.stdout.setEncoding('utf8')
      child.stderr.setEncoding('utf8')
      child.stdout.on('data', (chunk: string) => {
        stdout += chunk
        if (stdout.length > MAX_DRIVER_OUTPUT_BYTES) child.kill('SIGTERM')
      })
      child.stderr.on('data', (chunk: string) => {
        if (stderr.length < 8_000) stderr += chunk
      })
      child.once('error', (error) => {
        if (forceKill) clearTimeout(forceKill)
        signal?.removeEventListener('abort', abort)
        reject(
          new DesktopDriverError(
            'desktop_unavailable',
            `Could not start the local desktop driver: ${error.message}`,
          ),
        )
      })
      child.once('close', (code) => {
        if (forceKill) clearTimeout(forceKill)
        signal?.removeEventListener('abort', abort)
        if (signal?.aborted) {
          reject(new DesktopDriverError('cancelled', 'Desktop operation was cancelled'))
          return
        }
        if (stdout.length > MAX_DRIVER_OUTPUT_BYTES) {
          reject(new DesktopDriverError('driver_failure', 'Desktop driver response was too large'))
          return
        }
        let response: DriverResponse
        try {
          response = JSON.parse(stdout) as DriverResponse
        } catch {
          reject(
            new DesktopDriverError(
              'driver_failure',
              `Desktop driver returned invalid JSON${stderr ? `: ${stderr.trim()}` : ''}`,
            ),
          )
          return
        }
        if (code !== 0 || response.ok === false || response.status === 'error') {
          const error =
            typeof response.error === 'string'
              ? response.error
              : stderr.trim() || `Desktop driver exited with code ${String(code)}`
          reject(new DesktopDriverError(failureCode(response.status), error))
          return
        }
        resolve(response)
      })
      child.stdin.end(`${JSON.stringify(request)}\n`)
    })
  }

  async getDisplay(signal?: AbortSignal) {
    const response = await this.invoke({ version: 1, operation: 'display' }, signal)
    return parseDisplay(response.display)
  }

  async captureScreenshot(signal?: AbortSignal) {
    const response = await this.invoke({ version: 1, operation: 'screenshot' }, signal)
    return parseScreenshot(response.screenshot)
  }

  async execute(actions: readonly DesktopAction[], signal?: AbortSignal) {
    const response = await this.invoke(
      { version: 1, operation: 'execute', actions },
      signal,
    )
    const cursor = parseCursor(response.cursor)
    return {
      ...(response.screenshot !== undefined
        ? { screenshot: parseScreenshot(response.screenshot) }
        : {}),
      ...(cursor ? { cursor } : {}),
    }
  }
}

export type DesktopDriverFactory = () => DesktopDriver

let overrideFactory: DesktopDriverFactory | undefined

/** Test/embedding seam; pass undefined to restore environment configuration. */
export function setDesktopDriverFactory(factory: DesktopDriverFactory | undefined) {
  overrideFactory = factory
}

function configuredProcessDriver(): DesktopDriver {
  const executable = process.env.OPENBOT_DESKTOP_DRIVER?.trim()
  if (!executable) return new UnavailableDesktopDriver()

  let args: string[] = []
  const rawArgs = process.env.OPENBOT_DESKTOP_DRIVER_ARGS?.trim()
  if (rawArgs) {
    try {
      const parsed = JSON.parse(rawArgs) as unknown
      if (!Array.isArray(parsed) || !parsed.every((value) => typeof value === 'string')) {
        throw new Error('must be a JSON array of strings')
      }
      args = parsed
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'invalid JSON'
      return new UnavailableDesktopDriver(
        `Computer Use configuration is invalid: OPENBOT_DESKTOP_DRIVER_ARGS ${reason}`,
      )
    }
  }
  return new ProcessDesktopDriver(executable, args)
}

/** A fresh capability is constructed for every turn. */
export function createDesktopDriver() {
  return overrideFactory ? overrideFactory() : configuredProcessDriver()
}
