import { spawn } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { dataDirectory } from '@openbot/db'

/**
 * Per-agent isolated working area. Agent tools (runShell, Read, AwaitShell)
 * operate on files here; background shell output lands in `.shells/`.
 */
export function agentWorkspaceDirectory(agentId: string) {
  const workspace = path.join(dataDirectory, 'workspaces', agentId)
  mkdirSync(workspace, { recursive: true })
  return workspace
}

/** Resolves a workspace-relative path, or null when it escapes the workspace. */
export function resolveWorkspacePath(workspace: string, relative: string) {
  const resolved = path.resolve(workspace, relative)
  if (resolved !== workspace && !resolved.startsWith(workspace + path.sep)) return null
  return resolved
}

/** Minimal command environment: server credentials never reach agent shells. */
export function shellEnvironment(workspace: string) {
  return {
    PATH: process.env.PATH,
    HOME: workspace,
    LANG: process.env.LANG ?? 'en_US.UTF-8',
    TERM: 'dumb',
  }
}

export type ShellMeta = {
  shellId: string
  agentId: string
  command: string
  pid?: number
  startedAt: number
  endedAt?: number
  exitCode?: number | null
  signal?: string | null
  outputTruncated?: boolean
}

// Background shell output is capped so a runaway command cannot fill the disk.
const SHELL_OUTPUT_FILE_LIMIT = 10 * 1024 * 1024

function shellsDirectory(agentId: string) {
  const directory = path.join(agentWorkspaceDirectory(agentId), '.shells')
  mkdirSync(directory, { recursive: true })
  return directory
}

/** Workspace-relative output file path, readable with the Read tool. */
export function shellOutputRelativePath(shellId: string) {
  return path.join('.shells', `${shellId}.out`)
}

function shellMetaPath(agentId: string, shellId: string) {
  return path.join(shellsDirectory(agentId), `${shellId}.json`)
}

export async function readShellMeta(agentId: string, shellId: string): Promise<ShellMeta | null> {
  try {
    const raw = await readFile(shellMetaPath(agentId, shellId), 'utf8')
    return JSON.parse(raw) as ShellMeta
  } catch {
    return null
  }
}

export async function readShellOutput(agentId: string, shellId: string): Promise<string> {
  try {
    return await readFile(
      path.join(agentWorkspaceDirectory(agentId), shellOutputRelativePath(shellId)),
      'utf8',
    )
  } catch {
    return ''
  }
}

function nextShellId(agentId: string) {
  const taken = new Set(readdirSync(shellsDirectory(agentId)).map((name) => name.split('.')[0]))
  let id = taken.size + 1
  while (taken.has(String(id))) id += 1
  return String(id)
}

/**
 * Starts a detached background shell whose merged stdout/stderr streams to
 * `.shells/<id>.out` inside the agent workspace. Completion is recorded in a
 * sidecar meta file so status survives across turns (and server restarts).
 */
export async function startBackgroundShell(
  agentId: string,
  command: string,
  cwd: string,
): Promise<ShellMeta> {
  const workspace = agentWorkspaceDirectory(agentId)
  const shellId = nextShellId(agentId)
  const outputPath = path.join(workspace, shellOutputRelativePath(shellId))
  const output = createWriteStream(outputPath)

  const child = spawn('/bin/sh', ['-c', command], {
    cwd,
    detached: true,
    env: shellEnvironment(workspace),
  })

  const meta: ShellMeta = {
    shellId,
    agentId,
    command,
    ...(child.pid !== undefined && { pid: child.pid }),
    startedAt: Date.now(),
  }
  const persistMeta = () => writeFile(shellMetaPath(agentId, shellId), JSON.stringify(meta))

  let written = 0
  const collect = (chunk: Buffer) => {
    if (written >= SHELL_OUTPUT_FILE_LIMIT) {
      if (!meta.outputTruncated) {
        meta.outputTruncated = true
        output.write('\n…[output truncated: limit reached]…\n')
      }
      return
    }
    written += chunk.length
    output.write(chunk)
  }
  child.stdout.on('data', collect)
  child.stderr.on('data', collect)

  child.on('error', (error) => {
    output.write(`Failed to start command: ${error.message}\n`)
  })
  child.on('close', (code, signal) => {
    meta.endedAt = Date.now()
    meta.exitCode = code
    meta.signal = signal
    output.end()
    void persistMeta()
  })

  await persistMeta()
  return meta
}

export function shellExists(agentId: string, shellId: string) {
  return existsSync(shellMetaPath(agentId, shellId))
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Waits until the shell finishes or timeoutMs elapses, returning the latest
 * meta either way (endedAt set means it completed). Polling the meta file
 * keeps this working for shells started before a server restart.
 */
export async function waitForShell(
  agentId: string,
  shellId: string,
  timeoutMs: number,
): Promise<ShellMeta | null> {
  const deadline = Date.now() + timeoutMs
  while (true) {
    const meta = await readShellMeta(agentId, shellId)
    if (!meta || meta.endedAt !== undefined || Date.now() >= deadline) return meta
    await sleep(Math.min(250, deadline - Date.now()))
  }
}
