import { spawn, type ChildProcess } from 'node:child_process'
import { closeSync, openSync } from 'node:fs'
import { access, readFile } from 'node:fs/promises'
import { createConnection, createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { basename, isAbsolute, join } from 'node:path'
import { AGENT_SCREEN, type StartWindowDependencies } from './start-window-core'

const DEFAULT_START_TIMEOUT_MS = 10_000

function isNodeError(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code
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

async function isManagedDisplayProcess(
  pid: number,
  displayNumber: number,
  executable: string,
): Promise<boolean> {
  if (!processIsAlive(pid)) return false
  try {
    const commandLine = (await readFile(`/proc/${pid}/cmdline`))
      .toString('utf8')
      .split('\0')
      .filter(Boolean)
    return (
      commandLine.length > 0 &&
      basename(commandLine[0]) === basename(executable) &&
      commandLine.includes(`:${displayNumber}`)
    )
  } catch (error) {
    if (isNodeError(error, 'ENOENT') || isNodeError(error, 'EACCES')) return false
    throw error
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
) {
  const output = openSync(outputPath, 'w', 0o600)
  let child: ChildProcess
  try {
    child = spawn(
      executable,
      [
        `:${displayNumber}`,
        '-screen',
        '0',
        `${AGENT_SCREEN.width}x${AGENT_SCREEN.height}x${AGENT_SCREEN.depth}`,
        '-nolisten',
        'tcp',
        '-noreset',
      ],
      { detached: true, stdio: ['ignore', 'ignore', output] },
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
    isManagedDisplayProcess: (pid, displayNumber) =>
      isManagedDisplayProcess(pid, displayNumber, executable),
    isDisplayOccupied: displayIsOccupied,
    launchXvfb: (displayNumber, outputPath) =>
      launchXvfb(displayNumber, outputPath, executable, timeoutMs),
  }
}
