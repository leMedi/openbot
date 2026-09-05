import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { access } from 'node:fs/promises'
import { delimiter, join } from 'node:path'
import {
  ComputerUseClient,
  ComputerUseClientError,
  DESKTOP_HEIGHT,
  DESKTOP_WIDTH,
  type ComputerUseAction,
  type ComputerUseResult,
  type ComputerUseSuccess,
  type ExecStreamElement,
  type MouseButton,
  type ScrollDirection,
} from '@openbot/desktop-driver'
import { isDesktopEnabled } from './mode'

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
      description: string
    }
  | { action: 'move'; x: number; y: number; description: string }
  | {
      action: 'drag'
      button: 'left' | 'right' | 'middle'
      path: DesktopPoint[]
      description: string
    }
  | { action: 'type'; text: string; description: string }
  | { action: 'key'; key: string; description: string }
  | {
      action: 'scroll'
      direction: 'up' | 'down' | 'left' | 'right'
      amount: number
      at?: DesktopPoint
      description: string
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
    readonly execution?: DesktopDriverExecution,
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

const mouseButtons: Record<'left' | 'right' | 'middle', MouseButton> = {
  left: 'MOUSE_BUTTON_LEFT',
  right: 'MOUSE_BUTTON_RIGHT',
  middle: 'MOUSE_BUTTON_MIDDLE',
}

const scrollDirections: Record<'up' | 'down' | 'left' | 'right', ScrollDirection> = {
  up: 'SCROLL_DIRECTION_UP',
  down: 'SCROLL_DIRECTION_DOWN',
  left: 'SCROLL_DIRECTION_LEFT',
  right: 'SCROLL_DIRECTION_RIGHT',
}

function protocolAction(action: DesktopAction): ComputerUseAction {
  switch (action.action) {
    case 'screenshot':
      return { screenshot: {} }
    case 'click':
      return {
        click: {
          coordinate: { x: action.x, y: action.y },
          button: mouseButtons[action.button],
          count: action.clickCount,
        },
      }
    case 'move':
      return { mouse_move: { coordinate: { x: action.x, y: action.y } } }
    case 'drag':
      return { drag: { path: [...action.path], button: mouseButtons[action.button] } }
    case 'type':
      return { type: { text: action.text } }
    case 'key':
      return { key: { key: action.key } }
    case 'scroll':
      return {
        scroll: {
          ...(action.at && { coordinate: action.at }),
          direction: scrollDirections[action.direction],
          amount: action.amount,
        },
      }
    case 'wait':
      return { wait: { duration_ms: action.durationMs } }
  }
}

function protocolResult(element: ExecStreamElement): ComputerUseResult {
  if ('exec_client_control_message' in element) {
    const control = element.exec_client_control_message
    if ('throw' in control) throw new DesktopDriverError('driver_failure', control.throw.error)
    throw new DesktopDriverError('driver_failure', 'Desktop driver closed without a result')
  }
  return element.exec_client_message.computer_use_result
}

function desktopScreenshot(detail: ComputerUseSuccess): DesktopScreenshot | undefined {
  if (!detail.screenshot) return undefined
  return {
    dataBase64: detail.screenshot,
    mediaType: 'image/webp',
    width: DESKTOP_WIDTH,
    height: DESKTOP_HEIGHT,
    ...(detail.cursor_position && { cursor: detail.cursor_position }),
  }
}

function desktopFailureCode(code: string | undefined): DesktopFailureCode {
  return code === 'DESKTOP_UNAVAILABLE' ? 'desktop_unavailable' : 'driver_failure'
}

/**
 * Local executable protocol. The configured executable receives a protobuf-
 * shaped JSON request on stdin and returns one JSON stream element on stdout.
 * It is launched directly (never through a shell), so model input cannot
 * become a command. Display selection is trusted constructor configuration.
 */
export class ProcessDesktopDriver implements DesktopDriver {
  constructor(
    private readonly executable: string,
    private readonly displayNumber: number,
    private readonly args: readonly string[] = [],
  ) {}

  private async invoke(
    actions: readonly ComputerUseAction[],
    signal?: AbortSignal,
    options: { description?: string; bindUnmappedCharacters?: boolean } = {},
  ) {
    const client = new ComputerUseClient({
      executable: this.executable,
      displayNumber: this.displayNumber,
      arguments: this.args,
      timeoutMs: null,
    })
    try {
      return protocolResult(
        await client.exec(
          {
            id: 1,
            exec_id: randomUUID(),
            computer_use_args: {
              tool_call_id: randomUUID(),
              actions: [...actions],
              ...(options.description && { description: options.description }),
              ...(options.bindUnmappedCharacters && { bind_unmapped_characters: true }),
            },
          },
          signal,
        ),
      )
    } catch (error) {
      if (signal?.aborted) {
        throw new DesktopDriverError('cancelled', 'Desktop operation was cancelled')
      }
      if (error instanceof DesktopDriverError) throw error
      if (error instanceof ComputerUseClientError) {
        throw new DesktopDriverError(error.code, error.message)
      }
      throw new DesktopDriverError(
        'driver_failure',
        error instanceof Error ? error.message : 'Desktop driver failed',
      )
    } finally {
      await client.dispose()
    }
  }

  async getDisplay(signal?: AbortSignal) {
    const result = await this.invoke([{ cursor_position: {} }], signal)
    if ('error' in result) {
      throw new DesktopDriverError(desktopFailureCode(result.error.error_code), result.error.error)
    }
    return {
      width: DESKTOP_WIDTH,
      height: DESKTOP_HEIGHT,
      sessionId: `x11:${this.displayNumber}`,
    }
  }

  async captureScreenshot(signal?: AbortSignal) {
    const result = await this.invoke([{ screenshot: {} }], signal)
    if ('error' in result) {
      throw new DesktopDriverError(desktopFailureCode(result.error.error_code), result.error.error)
    }
    const detail = result.success
    const screenshot = desktopScreenshot(detail)
    if (!screenshot) throw new DesktopDriverError('driver_failure', 'Desktop driver returned no screenshot')
    return screenshot
  }

  async execute(actions: readonly DesktopAction[], signal?: AbortSignal) {
    const protocolActions = actions.map(protocolAction)
    // DesktopToolRuntime may append its compatibility screenshot after the
    // validated ten-action model sequence. The process executor adds that
    // screenshot itself, so do not send an eleventh protocol action.
    if (protocolActions.length > 10 && 'screenshot' in protocolActions.at(-1)!) {
      protocolActions.pop()
    }
    const description = actions
      .flatMap((action) => ('description' in action ? [action.description] : []))
      .join('; ')
      .slice(0, 500)
    const result = await this.invoke(protocolActions, signal, {
      description,
      bindUnmappedCharacters: actions.some((action) => action.action === 'type'),
    })
    if ('error' in result) {
      const screenshot = desktopScreenshot(result.error)
      throw new DesktopDriverError(
        desktopFailureCode(result.error.error_code),
        result.error.error,
        screenshot ? { screenshot } : undefined,
      )
    }
    const detail = result.success
    const screenshot = desktopScreenshot(detail)
    return {
      ...(screenshot && { screenshot }),
      ...(detail.cursor_position ? { cursor: detail.cursor_position } : {}),
    }
  }
}

export type DesktopDriverFactory = () => DesktopDriver

let overrideFactory: DesktopDriverFactory | undefined

/** Test/embedding seam; pass undefined to restore environment configuration. */
export function setDesktopDriverFactory(factory: DesktopDriverFactory | undefined) {
  overrideFactory = factory
}

function configuredDriverArguments() {
  const rawArgs = process.env.OPENBOT_DESKTOP_DRIVER_ARGS?.trim()
  if (!rawArgs) return []
  const parsed = JSON.parse(rawArgs) as unknown
  if (!Array.isArray(parsed) || !parsed.every((value) => typeof value === 'string')) {
    throw new Error('must be a JSON array of strings')
  }
  return parsed
}

function configuredProcessDriver(displayNumber: number | null | undefined): DesktopDriver {
  if (!isDesktopEnabled()) {
    return new UnavailableDesktopDriver(
      'Computer Use is unavailable because desktop mode is disabled',
    )
  }
  const executable = process.env.OPENBOT_DESKTOP_DRIVER?.trim()
  if (!executable) return new UnavailableDesktopDriver()

  let args: string[]
  try {
    args = configuredDriverArguments()
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'invalid JSON'
    return new UnavailableDesktopDriver(
      `Computer Use configuration is invalid: OPENBOT_DESKTOP_DRIVER_ARGS ${reason}`,
    )
  }
  if (displayNumber === null || displayNumber === undefined) {
    return new UnavailableDesktopDriver(
      'Computer Use is unavailable because this agent has no assigned X display',
    )
  }
  return new ProcessDesktopDriver(executable, displayNumber, args)
}

async function requireExecutable(command: string) {
  const candidates = command.includes('/')
    ? [command]
    : (process.env.PATH ?? '').split(delimiter).filter(Boolean).map((directory) => join(directory, command))
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK)
      return
    } catch {
      // Try the next PATH entry.
    }
  }
  throw new Error(`${command} was not found or is not executable`)
}

/** A fresh capability is constructed for every turn. */
export function createDesktopDriver(displayNumber?: number | null) {
  return overrideFactory ? overrideFactory() : configuredProcessDriver(displayNumber)
}

/** Checks host configuration without probing an agent-owned display. */
export async function getDesktopDriverStatus(): Promise<DesktopDisplay> {
  if (!isDesktopEnabled()) {
    throw new DesktopDriverError('desktop_unavailable', 'Desktop mode is disabled')
  }
  const executable = process.env.OPENBOT_DESKTOP_DRIVER?.trim()
  if (!executable) {
    throw new DesktopDriverError('desktop_unavailable', 'No local desktop driver is configured')
  }
  try {
    configuredDriverArguments()
    await Promise.all(
      [executable, 'xdotool', 'import', 'xmodmap'].map((command) => requireExecutable(command)),
    )
  } catch (error) {
    throw new DesktopDriverError(
      'desktop_unavailable',
      `Desktop driver configuration is not ready: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  return { width: DESKTOP_WIDTH, height: DESKTOP_HEIGHT, sessionId: 'per-agent' }
}
