import { spawn } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { dataDirectory } from '@openbot/db'

/**
 * Per-agent organizational working area on the Remote Desktop filesystem.
 * Agent tools operate on files here; background output lands in `.shells/`.
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
export function shellEnvironment(workspace: string, displayNumber?: number) {
  return {
    PATH: process.env.PATH,
    HOME: workspace,
    LANG: process.env.LANG ?? 'en_US.UTF-8',
    TERM: 'dumb',
    ...(displayNumber === undefined ? {} : { DISPLAY: `:${String(displayNumber)}` }),
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
  completionWakeEnabled?: boolean
  completionConversationId?: string
}

export type ShellCompletionCallback = (meta: ShellMeta) => Promise<void>

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
  onCompletion?: ShellCompletionCallback,
  displayNumber?: number,
) {
  const workspace = agentWorkspaceDirectory(agentId)
  const shellId = nextShellId(agentId)
  const outputPath = path.join(workspace, shellOutputRelativePath(shellId))
  const output = createWriteStream(outputPath)

  const child = spawn('/bin/sh', ['-c', command], {
    cwd,
    detached: true,
    env: shellEnvironment(workspace, displayNumber),
  })

  const meta: ShellMeta = {
    shellId,
    agentId,
    command,
    ...(child.pid !== undefined && { pid: child.pid }),
    startedAt: Date.now(),
  }
  let pendingWrite = Promise.resolve()
  const persistMeta = () => {
    pendingWrite = pendingWrite.then(() =>
      writeFile(shellMetaPath(agentId, shellId), JSON.stringify(meta)),
    )
    return pendingWrite
  }
  let completionNotified = false
  let completionAttempts = 0
  const notifyCompletion = async () => {
    if (
      completionNotified ||
      !onCompletion ||
      !meta.completionWakeEnabled ||
      !meta.completionConversationId ||
      meta.endedAt === undefined
    ) return
    completionAttempts += 1
    try {
      await onCompletion(meta)
      completionNotified = true
    } catch (error) {
      console.error('Shell completion wake failed', error)
      if (completionAttempts < 5) {
        setTimeout(() => void notifyCompletion(), 1_000)
      }
    }
  }

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
    output.end(() => {
      void persistMeta().then(notifyCompletion).catch((error) => {
        console.error('Shell completion persistence failed', error)
      })
    })
  })

  await persistMeta()
  return {
    meta,
    async enableCompletionWake(conversationId: string) {
      meta.completionWakeEnabled = true
      meta.completionConversationId = conversationId
      await persistMeta()
      await notifyCompletion()
    },
  }
}

/** Completed, wake-enabled shells discovered after a server restart. */
export async function listCompletedShellWakes() {
  const workspaces = path.join(dataDirectory, 'workspaces')
  if (!existsSync(workspaces)) return { completed: [], pending: false }
  const completed: ShellMeta[] = []
  let pending = false
  for (const agentId of readdirSync(workspaces)) {
    const directory = path.join(workspaces, agentId, '.shells')
    if (!existsSync(directory)) continue
    for (const name of readdirSync(directory)) {
      if (!name.endsWith('.json')) continue
      try {
        const candidate = JSON.parse(
          await readFile(path.join(directory, name), 'utf8'),
        ) as Partial<ShellMeta>
        if (
          typeof candidate.shellId !== 'string' ||
          typeof candidate.agentId !== 'string' ||
          typeof candidate.command !== 'string' ||
          typeof candidate.startedAt !== 'number'
        ) continue
        const meta = candidate as ShellMeta
        if (!meta.completionWakeEnabled || !meta.completionConversationId) continue
        if (meta.endedAt === undefined && meta.pid !== undefined) {
          try {
            process.kill(meta.pid, 0)
            pending = true
            continue
          } catch {
            // The original server cannot observe this detached child's exit.
            meta.endedAt = Date.now()
            meta.exitCode = null
            meta.signal = 'unknown-after-restart'
            await writeFile(path.join(directory, name), JSON.stringify(meta))
          }
        }
        if (meta.endedAt !== undefined) completed.push(meta)
      } catch {
        // An incomplete sidecar is retried on the next recovery pass.
      }
    }
  }
  return { completed, pending }
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
