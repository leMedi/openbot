import { spawn } from 'node:child_process'
import type {
  ComputerUseAction,
  ComputerUseArgs,
  ComputerUseResult,
  Coordinate,
  MouseButton,
  ScrollDirection,
} from './contract'
import { DESKTOP_HEIGHT, DESKTOP_WIDTH } from './contract'
import { webPDimensions } from './webp'

const MAX_ACTIONS = 10
const MAX_SCREENSHOT_BYTES = 25 * 1024 * 1024
const MAX_TEXT_LENGTH = 2_000
const MAX_WAIT_MS = 30_000

export type CommandResult = { stdout: Buffer; stderr: string }

export type DesktopExecutorDependencies = {
  run(
    command: string,
    arguments_: readonly string[],
    options?: { ignoreAbort?: boolean },
  ): Promise<CommandResult>
  wait(durationMs: number): Promise<void>
  now(): number
}

export class DesktopExecutionError extends Error {
  constructor(
    message: string,
    readonly code: 'DESKTOP_UNAVAILABLE' | 'DRIVER_FAILURE' = 'DRIVER_FAILURE',
  ) {
    super(message)
    this.name = 'DesktopExecutionError'
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function exactFields(value: Record<string, unknown>, name: string, allowed: readonly string[]) {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key))
  if (unknown.length > 0) {
    throw new DesktopExecutionError(`${name} contains unknown field: ${unknown.join(', ')}`)
  }
}

function integer(value: unknown, name: string, minimum: number, maximum: number) {
  if (!Number.isInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new DesktopExecutionError(`${name} must be an integer between ${minimum} and ${maximum}`)
  }
  return Number(value)
}

function string(value: unknown, name: string, maximum: number) {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum) {
    throw new DesktopExecutionError(`${name} must contain between 1 and ${maximum} characters`)
  }
  return value
}

function coordinate(value: unknown, name: string): Coordinate {
  if (!isObject(value)) throw new DesktopExecutionError(`${name} is required`)
  exactFields(value, name, ['x', 'y'])
  return {
    x: integer(value.x, `${name}.x`, 0, DESKTOP_WIDTH - 1),
    y: integer(value.y, `${name}.y`, 0, DESKTOP_HEIGHT - 1),
  }
}

async function verifyDisplayGeometry(dependencies: DesktopExecutorDependencies) {
  let result: CommandResult
  try {
    result = await dependencies.run('xdotool', ['getdisplaygeometry'])
  } catch (error) {
    throw new DesktopExecutionError(
      `Assigned X display is unavailable: ${errorMessage(error)}`,
      'DESKTOP_UNAVAILABLE',
    )
  }
  const match = /^(\d+)\s+(\d+)\s*$/.exec(result.stdout.toString('utf8'))
  if (!match) throw new DesktopExecutionError('Could not discover the X display dimensions')
  const width = Number(match[1])
  const height = Number(match[2])
  if (width !== DESKTOP_WIDTH || height !== DESKTOP_HEIGHT) {
    throw new DesktopExecutionError(
      `X display is ${width}×${height}; expected ${DESKTOP_WIDTH}×${DESKTOP_HEIGHT}`,
      'DESKTOP_UNAVAILABLE',
    )
  }
}

const mouseButtons: Partial<Record<MouseButton, string>> = {
  MOUSE_BUTTON_LEFT: '1',
  MOUSE_BUTTON_RIGHT: '3',
  MOUSE_BUTTON_MIDDLE: '2',
  MOUSE_BUTTON_BACK: '8',
  MOUSE_BUTTON_FORWARD: '9',
}

function mouseButton(value: unknown): string {
  if (typeof value !== 'string' || !mouseButtons[value as MouseButton]) {
    throw new DesktopExecutionError(`Unsupported mouse button: ${String(value)}`)
  }
  return mouseButtons[value as MouseButton]!
}

const scrollButtons: Partial<Record<ScrollDirection, string>> = {
  SCROLL_DIRECTION_UP: '4',
  SCROLL_DIRECTION_DOWN: '5',
  SCROLL_DIRECTION_LEFT: '6',
  SCROLL_DIRECTION_RIGHT: '7',
}

function scrollButton(value: unknown) {
  if (typeof value !== 'string' || !scrollButtons[value as ScrollDirection]) {
    throw new DesktopExecutionError(`Unsupported scroll direction: ${String(value)}`)
  }
  return scrollButtons[value as ScrollDirection]!
}

const modifierAliases: Record<string, string> = {
  alt: 'alt',
  ctrl: 'ctrl',
  control: 'ctrl',
  meta: 'super',
  shift: 'shift',
  super: 'super',
}

function modifiers(value: unknown): string[] {
  if (value === undefined) return []
  if (typeof value !== 'string' || value.length > 256) {
    throw new DesktopExecutionError('modifier_keys must be a string of at most 256 characters')
  }
  if (!value.trim()) return []
  return value
    .split(/[+,\s]+/)
    .filter(Boolean)
    .map((item) => {
      const key = modifierAliases[item.toLowerCase()]
      if (!key) throw new DesktopExecutionError(`Unsupported modifier key: ${item}`)
      return key
    })
}

function actionEntry(action: ComputerUseAction): [string, Record<string, unknown>] {
  if (!isObject(action)) throw new DesktopExecutionError('Each action must be an object')
  const entries = Object.entries(action)
  if (entries.length !== 1 || !isObject(entries[0]?.[1])) {
    throw new DesktopExecutionError('Each action must set exactly one action variant')
  }
  return entries[0] as [string, Record<string, unknown>]
}

async function withModifiers(
  keys: readonly string[],
  dependencies: DesktopExecutorDependencies,
  operation: () => Promise<void>,
) {
  const pressed: string[] = []
  let failure: unknown
  try {
    for (const key of keys) {
      // Include the current key before awaiting so cleanup is attempted even
      // when xdotool reports a failure after sending the key-down event.
      pressed.push(key)
      await dependencies.run('xdotool', ['keydown', key])
    }
    await operation()
  } catch (error) {
    failure = error
  }
  const cleanupFailures: string[] = []
  for (const key of pressed.reverse()) {
    try {
      await dependencies.run('xdotool', ['keyup', key], { ignoreAbort: true })
    } catch (error) {
      cleanupFailures.push(`${key}: ${errorMessage(error)}`)
    }
  }
  if (failure) {
    if (cleanupFailures.length > 0) {
      throw new DesktopExecutionError(
        `${errorMessage(failure)}; modifier cleanup failed (${cleanupFailures.join(', ')})`,
      )
    }
    throw failure
  }
  if (cleanupFailures.length > 0) {
    throw new DesktopExecutionError(`Modifier cleanup failed (${cleanupFailures.join(', ')})`)
  }
}

async function move(point: Coordinate, dependencies: DesktopExecutorDependencies) {
  await dependencies.run('xdotool', ['mousemove', '--sync', String(point.x), String(point.y)])
}

async function captureScreenshot(dependencies: DesktopExecutorDependencies) {
  const result = await dependencies.run('import', ['-window', 'root', 'webp:-'])
  if (result.stdout.length === 0 || result.stdout.length > MAX_SCREENSHOT_BYTES) {
    throw new DesktopExecutionError('Screenshot is empty or exceeds the 25 MB limit')
  }
  const dimensions = webPDimensions(result.stdout)
  if (!dimensions) throw new DesktopExecutionError('Screenshot utility did not return valid WebP data')
  if (dimensions.width !== DESKTOP_WIDTH || dimensions.height !== DESKTOP_HEIGHT) {
    throw new DesktopExecutionError(
      `Screenshot is ${dimensions.width}×${dimensions.height}; expected ${DESKTOP_WIDTH}×${DESKTOP_HEIGHT}`,
    )
  }
  return result.stdout.toString('base64')
}

async function cursorPosition(dependencies: DesktopExecutorDependencies): Promise<Coordinate> {
  const result = await dependencies.run('xdotool', ['getmouselocation', '--shell'])
  const output = result.stdout.toString('utf8')
  const x = /^X=(\d+)$/m.exec(output)?.[1]
  const y = /^Y=(\d+)$/m.exec(output)?.[1]
  if (x === undefined || y === undefined) {
    throw new DesktopExecutionError('Could not read the cursor position')
  }
  return {
    x: integer(Number(x), 'cursor x', 0, DESKTOP_WIDTH - 1),
    y: integer(Number(y), 'cursor y', 0, DESKTOP_HEIGHT - 1),
  }
}

async function captureDesktopState(
  dependencies: DesktopExecutorDependencies,
  state: ExecutionState,
) {
  state.screenshot = await captureScreenshot(dependencies)
  try {
    state.cursorPosition = await cursorPosition(dependencies)
  } catch {
    // Cursor position is optional when the screenshot itself succeeded.
  }
}

type ExecutionState = {
  screenshot?: string
  cursorPosition?: Coordinate
  log: string[]
  heldButtons: Set<string>
  mutationAttempted: boolean
}

const keyAliases: Record<string, string> = {
  backspace: 'BackSpace',
  delete: 'Delete',
  down: 'Down',
  arrowdown: 'Down',
  end: 'End',
  enter: 'Return',
  return: 'Return',
  esc: 'Escape',
  escape: 'Escape',
  home: 'Home',
  left: 'Left',
  arrowleft: 'Left',
  pagedown: 'Next',
  pageup: 'Prior',
  right: 'Right',
  arrowright: 'Right',
  space: 'space',
  tab: 'Tab',
  up: 'Up',
  arrowup: 'Up',
}

function keySequence(value: unknown) {
  return string(value, 'key.key', 256)
    .split('+')
    .map((part) => {
      const trimmed = part.trim()
      if (!trimmed) throw new DesktopExecutionError('key.key contains an empty key name')
      const lower = trimmed.toLowerCase()
      if (modifierAliases[lower]) return modifierAliases[lower]
      if (keyAliases[lower]) return keyAliases[lower]
      if (/^f(?:[1-9]|1\d|2[0-4])$/i.test(trimmed)) return trimmed.toUpperCase()
      if (/^[a-z]$/i.test(trimmed)) return lower
      return trimmed
    })
    .join('+')
}

type PreparedAction =
  | { kind: 'mouse_move'; point: Coordinate }
  | { kind: 'click'; point?: Coordinate; button: string; count: number; modifiers: string[] }
  | { kind: 'mouse_down'; button: string }
  | { kind: 'mouse_up'; button: string }
  | { kind: 'drag'; path: Coordinate[]; button: string; modifiers: string[] }
  | {
      kind: 'scroll'
      point?: Coordinate
      button: string
      amount: number
      direction: string
      modifiers: string[]
    }
  | { kind: 'type'; text: string }
  | { kind: 'key'; key: string; holdDuration?: number }
  | { kind: 'wait'; durationMs: number }
  | { kind: 'screenshot' }
  | { kind: 'cursor_position' }

function prepareAction(action: ComputerUseAction): PreparedAction {
  const [kind, value] = actionEntry(action)
  switch (kind) {
    case 'mouse_move':
      exactFields(value, kind, ['coordinate'])
      return { kind, point: coordinate(value.coordinate, 'mouse_move.coordinate') }
    case 'click':
      exactFields(value, kind, ['coordinate', 'button', 'count', 'modifier_keys'])
      return {
        kind,
        ...(value.coordinate !== undefined && {
          point: coordinate(value.coordinate, 'click.coordinate'),
        }),
        button: mouseButton(value.button),
        count: integer(value.count, 'click.count', 1, 3),
        modifiers: modifiers(value.modifier_keys),
      }
    case 'mouse_down':
    case 'mouse_up':
      exactFields(value, kind, ['button'])
      return { kind, button: mouseButton(value.button) }
    case 'drag': {
      exactFields(value, kind, ['path', 'button', 'modifier_keys'])
      if (!Array.isArray(value.path) || value.path.length < 2 || value.path.length > 64) {
        throw new DesktopExecutionError('drag.path must contain between 2 and 64 coordinates')
      }
      return {
        kind,
        path: value.path.map((point, index) => coordinate(point, `drag.path[${index}]`)),
        button: mouseButton(value.button),
        modifiers: modifiers(value.modifier_keys),
      }
    }
    case 'scroll':
      exactFields(value, kind, ['coordinate', 'direction', 'amount', 'modifier_keys'])
      return {
        kind,
        ...(value.coordinate !== undefined && {
          point: coordinate(value.coordinate, 'scroll.coordinate'),
        }),
        button: scrollButton(value.direction),
        amount: integer(value.amount, 'scroll.amount', 1, 10_000),
        direction: String(value.direction),
        modifiers: modifiers(value.modifier_keys),
      }
    case 'type':
      exactFields(value, kind, ['text'])
      return { kind, text: string(value.text, 'type.text', MAX_TEXT_LENGTH) }
    case 'key':
      exactFields(value, kind, ['key', 'hold_duration_ms'])
      return {
        kind,
        key: keySequence(value.key),
        ...(value.hold_duration_ms !== undefined && {
          holdDuration: integer(value.hold_duration_ms, 'key.hold_duration_ms', 0, MAX_WAIT_MS),
        }),
      }
    case 'wait':
      exactFields(value, kind, ['duration_ms'])
      return {
        kind,
        durationMs: integer(value.duration_ms, 'wait.duration_ms', 0, MAX_WAIT_MS),
      }
    case 'screenshot':
    case 'cursor_position':
      if (Object.keys(value).length > 0) {
        throw new DesktopExecutionError(`${kind} does not accept fields`)
      }
      return { kind }
    default:
      throw new DesktopExecutionError(`Unsupported action variant: ${kind}`)
  }
}

const mutatingActionKinds = new Set<PreparedAction['kind']>([
  'mouse_move',
  'click',
  'mouse_down',
  'mouse_up',
  'drag',
  'scroll',
  'type',
  'key',
])

function validateMouseButtonPairs(actions: readonly PreparedAction[]) {
  const held = new Set<string>()
  for (const action of actions) {
    if (action.kind === 'mouse_down') held.add(action.button)
    if (action.kind === 'mouse_up') held.delete(action.button)
  }
  if (held.size > 0) {
    throw new DesktopExecutionError('Every mouse_down action must have a matching mouse_up action')
  }
}

async function validateMappedText(
  actions: readonly PreparedAction[],
  bindUnmappedCharacters: boolean,
  dependencies: DesktopExecutorDependencies,
) {
  if (bindUnmappedCharacters) return
  const codePoints = new Set(
    actions
      .filter((action): action is Extract<PreparedAction, { kind: 'type' }> => action.kind === 'type')
      .flatMap((action) => [...action.text])
      .map((character) => character.codePointAt(0)!)
      .filter((codePoint) => ![9, 10, 13].includes(codePoint)),
  )
  if (codePoints.size === 0) return
  const result = await dependencies.run('xmodmap', ['-pk'])
  const mapped = new Set(
    [...result.stdout.toString('utf8').matchAll(/0x([0-9a-f]+)/gi)].map((match) =>
      Number.parseInt(match[1]!, 16),
    ),
  )
  for (const codePoint of codePoints) {
    const unicodeKeysym = 0x01000000 + codePoint
    if (!mapped.has(codePoint) && !mapped.has(unicodeKeysym)) {
      throw new DesktopExecutionError(
        `type.text character U+${codePoint.toString(16).toUpperCase().padStart(4, '0')} is not mapped; set bind_unmapped_characters to true`,
      )
    }
  }
}

async function executeAction(
  action: PreparedAction,
  dependencies: DesktopExecutorDependencies,
  state: ExecutionState,
) {
  switch (action.kind) {
    case 'mouse_move': {
      await move(action.point, dependencies)
      state.cursorPosition = action.point
      state.log.push(`move (${action.point.x}, ${action.point.y})`)
      return
    }
    case 'click': {
      if (action.point) await move(action.point, dependencies)
      await withModifiers(action.modifiers, dependencies, async () => {
        await dependencies.run('xdotool', [
          'click',
          '--repeat',
          String(action.count),
          '--delay',
          '80',
          action.button,
        ])
      })
      state.log.push(`click button ${action.button} ×${action.count}`)
      return
    }
    case 'mouse_down': {
      // Track before awaiting because xdotool can report failure after X has
      // accepted the button-down event.
      state.heldButtons.add(action.button)
      await dependencies.run('xdotool', ['mousedown', action.button])
      state.log.push(`mouse down ${action.button}`)
      return
    }
    case 'mouse_up': {
      await dependencies.run('xdotool', ['mouseup', action.button])
      state.heldButtons.delete(action.button)
      state.log.push(`mouse up ${action.button}`)
      return
    }
    case 'drag': {
      await withModifiers(action.modifiers, dependencies, async () => {
        await move(action.path[0]!, dependencies)
        state.heldButtons.add(action.button)
        try {
          await dependencies.run('xdotool', ['mousedown', action.button])
          for (const point of action.path.slice(1)) await move(point, dependencies)
        } finally {
          await dependencies.run('xdotool', ['mouseup', action.button], { ignoreAbort: true })
          state.heldButtons.delete(action.button)
        }
      })
      state.cursorPosition = action.path.at(-1)
      state.log.push(`drag ${action.path.length} points`)
      return
    }
    case 'scroll': {
      if (action.point) await move(action.point, dependencies)
      await withModifiers(action.modifiers, dependencies, async () => {
        await dependencies.run('xdotool', [
          'click',
          '--repeat',
          String(action.amount),
          '--delay',
          '10',
          action.button,
        ])
      })
      state.log.push(`scroll ${action.direction} ${action.amount}`)
      return
    }
    case 'type': {
      await dependencies.run('xdotool', [
        'type',
        '--clearmodifiers',
        '--delay',
        '1',
        '--',
        action.text,
      ])
      state.log.push(`type ${action.text.length} characters`)
      return
    }
    case 'key': {
      if (action.holdDuration === undefined) {
        await dependencies.run('xdotool', ['key', '--clearmodifiers', action.key])
      } else {
        let failure: unknown
        try {
          await dependencies.run('xdotool', ['keydown', '--clearmodifiers', action.key])
          await dependencies.wait(action.holdDuration)
        } catch (error) {
          failure = error
        }
        try {
          await dependencies.run('xdotool', ['keyup', action.key], { ignoreAbort: true })
        } catch (error) {
          if (failure) {
            throw new DesktopExecutionError(
              `${errorMessage(failure)}; key cleanup failed (${errorMessage(error)})`,
            )
          }
          throw error
        }
        if (failure) throw failure
      }
      state.log.push(`key ${action.key}`)
      return
    }
    case 'wait': {
      await dependencies.wait(action.durationMs)
      state.log.push(`wait ${action.durationMs}ms`)
      return
    }
    case 'screenshot':
      await captureDesktopState(dependencies, state)
      state.log.push('screenshot')
      return
    case 'cursor_position':
      state.cursorPosition = await cursorPosition(dependencies)
      state.log.push('cursor position')
      return
  }
}

export async function executeComputerUse(
  args: ComputerUseArgs,
  dependencies: DesktopExecutorDependencies,
): Promise<ComputerUseResult> {
  const startedAt = dependencies.now()
  const state: ExecutionState = {
    log: [],
    heldButtons: new Set(),
    mutationAttempted: false,
  }
  let actionCount = 0
  try {
    if (!isObject(args)) throw new DesktopExecutionError('computer_use_args is required')
    exactFields(args, 'computer_use_args', [
      'tool_call_id',
      'actions',
      'description',
      'bind_unmapped_characters',
    ])
    string(args.tool_call_id, 'tool_call_id', 512)
    if (!Array.isArray(args.actions) || args.actions.length === 0 || args.actions.length > MAX_ACTIONS) {
      throw new DesktopExecutionError(`actions must contain between 1 and ${MAX_ACTIONS} items`)
    }
    if (args.description !== undefined && (typeof args.description !== 'string' || args.description.length > 500)) {
      throw new DesktopExecutionError('description must be a string of at most 500 characters')
    }
    if (args.bind_unmapped_characters !== undefined && typeof args.bind_unmapped_characters !== 'boolean') {
      throw new DesktopExecutionError('bind_unmapped_characters must be a boolean')
    }
    const actions = args.actions.map(prepareAction)
    validateMouseButtonPairs(actions)
    await verifyDisplayGeometry(dependencies)
    await validateMappedText(actions, args.bind_unmapped_characters === true, dependencies)
    for (const action of actions) {
      if (mutatingActionKinds.has(action.kind)) state.mutationAttempted = true
      await executeAction(action, dependencies, state)
      actionCount += 1
    }
    if (state.mutationAttempted && actions.at(-1)?.kind !== 'screenshot') {
      await captureDesktopState(dependencies, state)
      state.log.push('automatic final screenshot')
    }
    return {
      success: {
        action_count: actionCount,
        duration_ms: Math.max(0, dependencies.now() - startedAt),
        ...(state.screenshot && { screenshot: state.screenshot }),
        ...(state.log.length > 0 && { log: state.log.join(', ') }),
        ...(state.cursorPosition && { cursor_position: state.cursorPosition }),
      },
    }
  } catch (error) {
    for (const button of state.heldButtons) {
      try {
        await dependencies.run('xdotool', ['mouseup', button], { ignoreAbort: true })
      } catch {
        state.log.push(`failed to release mouse button ${button}`)
      }
    }
    state.heldButtons.clear()
    if (state.mutationAttempted) {
      try {
        await captureDesktopState(dependencies, state)
        state.log.push('automatic final screenshot after failure')
      } catch {
        // Preserve the action failure when the desktop is also unavailable.
      }
    }
    return {
      error: {
        error: errorMessage(error),
        error_code: error instanceof DesktopExecutionError ? error.code : 'DRIVER_FAILURE',
        action_count: actionCount,
        duration_ms: Math.max(0, dependencies.now() - startedAt),
        ...(state.log.length > 0 && { log: state.log.join(', ') }),
        ...(state.screenshot && { screenshot: state.screenshot }),
        ...(state.cursorPosition && { cursor_position: state.cursorPosition }),
      },
    }
  }
}

export function systemDependencies(
  displayNumber: number,
  signal?: AbortSignal,
): DesktopExecutorDependencies {
  const environment = { ...process.env, DISPLAY: `:${displayNumber}` }
  return {
    now: Date.now,
    wait: (durationMs) =>
      new Promise((resolve, reject) => {
        if (signal?.aborted) {
          reject(signal.reason ?? new Error('Desktop operation was cancelled'))
          return
        }
        const timeout = setTimeout(finish, durationMs)
        const abort = () => {
          clearTimeout(timeout)
          signal?.removeEventListener('abort', abort)
          reject(signal?.reason ?? new Error('Desktop operation was cancelled'))
        }
        function finish() {
          signal?.removeEventListener('abort', abort)
          resolve()
        }
        signal?.addEventListener('abort', abort, { once: true })
      }),
    run: (command, arguments_, options) =>
      new Promise((resolve, reject) => {
        const child = spawn(command, [...arguments_], {
          env: environment,
          ...(!options?.ignoreAbort && signal ? { signal } : {}),
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
        })
        const stdout: Buffer[] = []
        let stdoutBytes = 0
        let stderr = ''
        child.stdout.on('data', (chunk: Buffer) => {
          stdoutBytes += chunk.length
          if (stdoutBytes <= MAX_SCREENSHOT_BYTES) stdout.push(chunk)
          else child.kill('SIGTERM')
        })
        child.stderr.setEncoding('utf8')
        child.stderr.on('data', (chunk: string) => {
          if (stderr.length < 8_000) stderr += chunk
        })
        child.once('error', (error) => reject(new DesktopExecutionError(`Could not start ${command}: ${error.message}`)))
        child.once('close', (code) => {
          if (stdoutBytes > MAX_SCREENSHOT_BYTES) {
            reject(new DesktopExecutionError(`${command} output exceeded the 25 MB limit`))
          } else if (code !== 0) {
            reject(new DesktopExecutionError(stderr.trim() || `${command} exited with code ${String(code)}`))
          } else {
            resolve({ stdout: Buffer.concat(stdout), stderr })
          }
        })
      }),
  }
}
