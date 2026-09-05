import { randomUUID } from 'node:crypto'
import { DESKTOP_HEIGHT, DESKTOP_WIDTH } from '@openbot/desktop-driver'
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { join } from 'node:path'
import { isNodeError } from './node-errors'

export const EXIT_UNAVAILABLE = 75
export const AGENT_SCREEN = {
  width: DESKTOP_WIDTH,
  height: DESKTOP_HEIGHT,
  depth: 24,
} as const
const DISPLAY_NUMBER_MAX = 65_535

export type StartWindowInput = {
  displayNumber: number
  ownerId: string
}

export type StartWindowResult = {
  exitCode: number
  error?: string
}

type WindowState = {
  version: 1
  status: 'starting' | 'running'
  displayNumber: number
  ownerId: string
  pid: number
  width: number
  height: number
  depth: number
  startedAt: string
}

type LaunchedDisplay = {
  pid: number
  stop: () => Promise<void>
}

export type StartWindowDependencies = {
  stateDirectory: string
  processId: number
  now: () => string
  acquireOperationLock: (displayNumber: number) => Promise<(() => Promise<void>) | undefined>
  isManagedDisplayProcess: (pid: number, displayNumber: number) => Promise<boolean>
  isDisplayOccupied: (displayNumber: number) => Promise<boolean>
  launchXvfb: (displayNumber: number, logPath: string) => Promise<LaunchedDisplay>
}

function usageError(message: string): Error {
  return new Error(`${message}\nUsage: start-window <display-number> <owner-id>`)
}

export function parseStartWindowArguments(arguments_: readonly string[]): StartWindowInput {
  if (arguments_.length !== 2) {
    throw usageError('Expected exactly two arguments')
  }

  const [displayValue, ownerId] = arguments_
  if (!/^(0|[1-9]\d*)$/.test(displayValue)) {
    throw usageError('display-number must be a non-negative integer')
  }
  const displayNumber = Number(displayValue)
  if (!Number.isSafeInteger(displayNumber) || displayNumber > DISPLAY_NUMBER_MAX) {
    throw usageError(`display-number must be between 0 and ${DISPLAY_NUMBER_MAX}`)
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(ownerId)) {
    throw usageError(
      'owner-id must contain 1-200 letters, numbers, periods, underscores, colons, or hyphens',
    )
  }

  return { displayNumber, ownerId }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function statePath(directory: string, displayNumber: number) {
  return join(directory, `display-${displayNumber}.json`)
}

function logPath(directory: string, displayNumber: number) {
  return join(directory, `display-${displayNumber}.log`)
}

function parseState(value: string, expectedDisplayNumber: number): WindowState {
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new Error(`Ownership state for display :${expectedDisplayNumber} is invalid JSON`)
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`Ownership state for display :${expectedDisplayNumber} is invalid`)
  }
  const state = parsed as Partial<WindowState>
  if (
    state.version !== 1 ||
    (state.status !== 'starting' && state.status !== 'running') ||
    state.displayNumber !== expectedDisplayNumber ||
    typeof state.ownerId !== 'string' ||
    !Number.isInteger(state.pid) ||
    Number(state.pid) <= 0 ||
    state.width !== AGENT_SCREEN.width ||
    state.height !== AGENT_SCREEN.height ||
    state.depth !== AGENT_SCREEN.depth ||
    typeof state.startedAt !== 'string'
  ) {
    throw new Error(`Ownership state for display :${expectedDisplayNumber} is invalid`)
  }
  return state as WindowState
}

async function readState(path: string, displayNumber: number): Promise<WindowState | undefined> {
  try {
    return parseState(await readFile(path, 'utf8'), displayNumber)
  } catch (error) {
    if (isNodeError(error, 'ENOENT')) return undefined
    throw error
  }
}

async function prepareStateDirectory(directory: string) {
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const info = await lstat(directory)
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error(`Runtime state path is not a directory: ${directory}`)
  }
  if (typeof process.getuid === 'function' && info.uid !== process.getuid()) {
    throw new Error(`Runtime state directory is owned by another user: ${directory}`)
  }
  await chmod(directory, 0o700)
}

function makeState(
  input: StartWindowInput,
  status: WindowState['status'],
  pid: number,
  startedAt: string,
): WindowState {
  return {
    version: 1,
    status,
    displayNumber: input.displayNumber,
    ownerId: input.ownerId,
    pid,
    ...AGENT_SCREEN,
    startedAt,
  }
}

async function safelyUnlink(path: string) {
  try {
    await unlink(path)
  } catch (error) {
    if (!isNodeError(error, 'ENOENT')) throw error
  }
}

async function replaceState(path: string, state: WindowState) {
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`
  try {
    await writeFile(temporaryPath, `${JSON.stringify(state)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    })
    await rename(temporaryPath, path)
  } finally {
    await safelyUnlink(temporaryPath)
  }
}

/** Provision one fixed X display and persist its agent ownership. */
export async function provisionAgentWindow(
  input: StartWindowInput,
  dependencies: StartWindowDependencies,
): Promise<StartWindowResult> {
  try {
    await prepareStateDirectory(dependencies.stateDirectory)
    const releaseLock = await dependencies.acquireOperationLock(input.displayNumber)
    if (!releaseLock) {
      return {
        exitCode: EXIT_UNAVAILABLE,
        error: `Display :${input.displayNumber} is still being started`,
      }
    }
    try {
      return await provisionWithLock(input, dependencies)
    } finally {
      await releaseLock()
    }
  } catch (error) {
    return { exitCode: 1, error: errorMessage(error) }
  }
}

async function provisionWithLock(
  input: StartWindowInput,
  dependencies: StartWindowDependencies,
): Promise<StartWindowResult> {
  const path = statePath(dependencies.stateDirectory, input.displayNumber)

  try {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      let existing: WindowState | undefined
      try {
        existing = await readState(path, input.displayNumber)
      } catch (error) {
        if (await dependencies.isDisplayOccupied(input.displayNumber)) {
          return {
            exitCode: EXIT_UNAVAILABLE,
            error: `Display :${input.displayNumber} is unavailable`,
          }
        }
        throw error
      }
      const occupied = await dependencies.isDisplayOccupied(input.displayNumber)

      if (existing) {
        const managedProcess = await dependencies.isManagedDisplayProcess(
          existing.pid,
          input.displayNumber,
        )
        if (existing.status === 'running' && existing.ownerId === input.ownerId) {
          if (managedProcess && occupied) return { exitCode: 0 }
          if (managedProcess || occupied) {
            return {
              exitCode: EXIT_UNAVAILABLE,
              error: `Display :${input.displayNumber} is unavailable`,
            }
          }
        } else if (managedProcess || occupied) {
          return {
            exitCode: EXIT_UNAVAILABLE,
            error:
              existing.ownerId === input.ownerId
                ? `Display :${input.displayNumber} is still being started`
                : `Display :${input.displayNumber} is owned by another agent`,
          }
        }

        await safelyUnlink(path)
      } else if (occupied) {
        return {
          exitCode: EXIT_UNAVAILABLE,
          error: `Display :${input.displayNumber} is unavailable`,
        }
      }

      const startedAt = dependencies.now()
      const claim = makeState(input, 'starting', dependencies.processId, startedAt)
      try {
        await writeFile(path, `${JSON.stringify(claim)}\n`, {
          encoding: 'utf8',
          flag: 'wx',
          mode: 0o600,
        })
      } catch (error) {
        if (isNodeError(error, 'EEXIST')) continue
        throw error
      }

      let launched: LaunchedDisplay | undefined
      try {
        launched = await dependencies.launchXvfb(
          input.displayNumber,
          logPath(dependencies.stateDirectory, input.displayNumber),
        )
        const running = makeState(input, 'running', launched.pid, startedAt)
        await replaceState(path, running)
        return { exitCode: 0 }
      } catch (error) {
        if (launched) await launched.stop()
        await safelyUnlink(path)
        if (await dependencies.isDisplayOccupied(input.displayNumber)) {
          return {
            exitCode: EXIT_UNAVAILABLE,
            error: `Display :${input.displayNumber} is unavailable`,
          }
        }
        return { exitCode: 1, error: errorMessage(error) }
      }
    }

    return {
      exitCode: EXIT_UNAVAILABLE,
      error: `Display :${input.displayNumber} ownership is changing`,
    }
  } catch (error) {
    return { exitCode: 1, error: errorMessage(error) }
  }
}
