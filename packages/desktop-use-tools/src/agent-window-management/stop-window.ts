#!/usr/bin/env node

import { chmod, lstat, mkdir, readFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { isNodeError } from './node-errors'
import { EXIT_UNAVAILABLE, parseStartWindowArguments } from './start-window-core'
import { systemDependencies } from './xvfb'

const dependencies = systemDependencies()

async function processIsManaged(pid: number, displayNumber: number) {
  return dependencies.isManagedDisplayProcess(pid, displayNumber)
}

async function stopProcessGroup(pid: number, displayNumber: number) {
  if (!await processIsManaged(pid, displayNumber)) return
  try {
    process.kill(-pid, 'SIGTERM')
  } catch (error) {
    if (!isNodeError(error, 'ESRCH')) throw error
  }
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (!await processIsManaged(pid, displayNumber)) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  if (!await processIsManaged(pid, displayNumber)) return
  try {
    process.kill(-pid, 'SIGKILL')
  } catch (error) {
    if (!isNodeError(error, 'ESRCH')) throw error
  }
}

async function main() {
  let releaseLock: (() => Promise<void>) | undefined
  try {
    let input
    try {
      input = parseStartWindowArguments(process.argv.slice(2))
    } catch (error) {
      throw new Error(
        (error instanceof Error ? error.message : String(error)).replaceAll('start-window', 'stop-window'),
      )
    }

    await mkdir(dependencies.stateDirectory, { recursive: true, mode: 0o700 })
    const directory = await lstat(dependencies.stateDirectory)
    if (!directory.isDirectory() || directory.isSymbolicLink()) {
      throw new Error(`Runtime state path is not a directory: ${dependencies.stateDirectory}`)
    }
    if (typeof process.getuid === 'function' && directory.uid !== process.getuid()) {
      throw new Error(`Runtime state directory is owned by another user: ${dependencies.stateDirectory}`)
    }
    await chmod(dependencies.stateDirectory, 0o700)

    releaseLock = await dependencies.acquireOperationLock(input.displayNumber)
    if (!releaseLock) {
      process.stderr.write(`Display :${input.displayNumber} ownership is changing\n`)
      process.exitCode = EXIT_UNAVAILABLE
      return
    }

    const path = join(dependencies.stateDirectory, `display-${input.displayNumber}.json`)
    let raw: string
    try {
      raw = await readFile(path, 'utf8')
    } catch (error) {
      if (isNodeError(error, 'ENOENT') && !await dependencies.isDisplayOccupied(input.displayNumber)) {
        process.exitCode = 0
        return
      }
      throw error
    }
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') throw new Error('Invalid desktop ownership state')
    const state = parsed as Record<string, unknown>
    if (
      state.version !== 1 ||
      state.displayNumber !== input.displayNumber ||
      state.ownerId !== input.ownerId ||
      !Number.isSafeInteger(state.pid) ||
      Number(state.pid) <= 0
    ) {
      process.stderr.write(`Display :${input.displayNumber} is not owned by ${input.ownerId}\n`)
      process.exitCode = EXIT_UNAVAILABLE
      return
    }

    const pid = Number(state.pid)
    if (!await processIsManaged(pid, input.displayNumber)) {
      if (await dependencies.isDisplayOccupied(input.displayNumber)) {
        process.stderr.write(`Display :${input.displayNumber} is unavailable\n`)
        process.exitCode = EXIT_UNAVAILABLE
        return
      }
    } else {
      await stopProcessGroup(pid, input.displayNumber)
    }
    await unlink(path).catch((error) => {
      if (!isNodeError(error, 'ENOENT')) throw error
    })
    process.exitCode = 0
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  } finally {
    await releaseLock?.().catch(() => {})
  }
}

void main()
