import { spawn, type ChildProcess } from 'node:child_process'
import {
  access,
  chmod,
  lstat,
  mkdir,
  readFile,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { closeSync, openSync } from 'node:fs'
import { createConnection, createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'

export const EXIT_UNAVAILABLE = 75
const SCREEN = { width: 1280, height: 800, depth: 24 } as const
const DEFAULT_START_TIMEOUT_MS = 10_000
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
  isProcessAlive: (pid: number) => boolean
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

function isNodeError(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code
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
    state.width !== SCREEN.width ||
    state.height !== SCREEN.height ||
    state.depth !== SCREEN.depth ||
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
    ...SCREEN,
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

/** Provision one fixed X display and persist its agent ownership. */
export async function provisionAgentWindow(
  input: StartWindowInput,
  dependencies: StartWindowDependencies = systemDependencies(),
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
      const existing = await readState(path, input.displayNumber)
      const occupied = await dependencies.isDisplayOccupied(input.displayNumber)

      if (existing) {
        const processAlive = dependencies.isProcessAlive(existing.pid)
        if (existing.status === 'running' && existing.ownerId === input.ownerId) {
          if (processAlive && occupied) return { exitCode: 0 }
          if (processAlive || occupied) {
            return {
              exitCode: EXIT_UNAVAILABLE,
              error: `Display :${input.displayNumber} is unavailable`,
            }
          }
        } else if (processAlive || occupied) {
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
        await writeFile(path, `${JSON.stringify(running)}\n`, {
          encoding: 'utf8',
          mode: 0o600,
        })
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

function runtimeStateDirectory(environment: NodeJS.ProcessEnv): string {
  const xdgRuntimeDirectory = environment.XDG_RUNTIME_DIR
  if (xdgRuntimeDirectory) {
    if (!isAbsolute(xdgRuntimeDirectory)) {
      throw new Error('XDG_RUNTIME_DIR must be an absolute path')
    }
    return join(xdgRuntimeDirectory, 'openbot', 'agent-window-management')
  }
  const uid = typeof process.getuid === 'function' ? process.getuid() : process.pid
  return join(tmpdir(), `openbot-agent-window-management-${uid}`)
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return isNodeError(error, 'EPERM')
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch (error) {
    if (isNodeError(error, 'ENOENT')) return false
    throw error
  }
}

async function canConnectToDisplay(displayNumber: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection(`/tmp/.X11-unix/X${displayNumber}`)
    let settled = false
    const finish = (connected: boolean) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(connected)
    }
    socket.setTimeout(250)
    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
    socket.once('timeout', () => finish(false))
  })
}

async function displayIsOccupied(displayNumber: number): Promise<boolean> {
  if (await pathExists(`/tmp/.X${displayNumber}-lock`)) return true
  return canConnectToDisplay(displayNumber)
}

async function acquireOperationLock(
  displayNumber: number,
): Promise<(() => Promise<void>) | undefined> {
  const uid = typeof process.getuid === 'function' ? process.getuid() : process.pid
  const server = createServer()
  server.unref()
  const acquired = await new Promise<boolean>((resolve, reject) => {
    server.once('error', (error) => {
      if (isNodeError(error, 'EADDRINUSE')) resolve(false)
      else reject(error)
    })
    server.listen(`\0openbot-agent-window-${uid}-${displayNumber}`, () => resolve(true))
  })
  if (!acquired) return undefined
  return () =>
    new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
    })
}

function sleep(durationMs: number) {
  return new Promise((resolve) => setTimeout(resolve, durationMs))
}

async function readStartupLog(path: string): Promise<string> {
  try {
    return (await readFile(path, 'utf8')).trim()
  } catch {
    return ''
  }
}

async function stopChild(child: ChildProcess, exited: () => boolean) {
  if (exited() || !child.pid) return
  try {
    process.kill(-child.pid, 'SIGTERM')
  } catch (error) {
    if (!isNodeError(error, 'ESRCH')) throw error
  }
  for (let attempt = 0; attempt < 20 && !exited(); attempt += 1) await sleep(50)
  if (!exited()) {
    try {
      process.kill(-child.pid, 'SIGKILL')
    } catch (error) {
      if (!isNodeError(error, 'ESRCH')) throw error
    }
  }
}

async function launchXvfb(
  displayNumber: number,
  outputPath: string,
  executable: string,
  timeoutMs: number,
): Promise<LaunchedDisplay> {
  const output = openSync(outputPath, 'w', 0o600)
  let child: ChildProcess
  try {
    child = spawn(
      executable,
      [
        `:${displayNumber}`,
        '-screen',
        '0',
        `${SCREEN.width}x${SCREEN.height}x${SCREEN.depth}`,
        '-nolisten',
        'tcp',
        '-noreset',
      ],
      {
        detached: true,
        stdio: ['ignore', 'ignore', output],
      },
    )
  } finally {
    closeSync(output)
  }

  let spawnError: Error | undefined
  let exitCode: number | null | undefined
  child.once('error', (error) => {
    spawnError = error
  })
  child.once('exit', (code) => {
    exitCode = code
  })

  const exited = () => exitCode !== undefined || spawnError !== undefined
  const stop = () => stopChild(child, exited)
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (spawnError) throw spawnError
    if (exitCode !== undefined) {
      const detail = await readStartupLog(outputPath)
      throw new Error(detail || `Xvfb exited with code ${exitCode ?? 'unknown'}`)
    }
    if (await canConnectToDisplay(displayNumber)) {
      if (!child.pid) throw new Error('Xvfb started without reporting a process id')
      child.unref()
      return { pid: child.pid, stop }
    }
    await sleep(50)
  }

  await stop()
  const detail = await readStartupLog(outputPath)
  throw new Error(detail || `Timed out waiting for Xvfb display :${displayNumber}`)
}

function positiveInteger(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error('OPENBOT_XVFB_START_TIMEOUT_MS must be a positive integer')
  }
  return parsed
}

export function systemDependencies(
  environment: NodeJS.ProcessEnv = process.env,
): StartWindowDependencies {
  const executable = environment.OPENBOT_XVFB_PATH || 'Xvfb'
  const timeoutMs = positiveInteger(
    environment.OPENBOT_XVFB_START_TIMEOUT_MS,
    DEFAULT_START_TIMEOUT_MS,
  )
  return {
    stateDirectory: runtimeStateDirectory(environment),
    processId: process.pid,
    now: () => new Date().toISOString(),
    acquireOperationLock,
    isProcessAlive: processIsAlive,
    isDisplayOccupied: displayIsOccupied,
    launchXvfb: (displayNumber, outputPath) =>
      launchXvfb(displayNumber, outputPath, executable, timeoutMs),
  }
}
