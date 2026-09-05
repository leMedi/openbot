import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  ComputerUseError,
  ComputerUseSuccess,
  ExecServerMessage,
  ExecStreamElement,
} from './contract'
import { DESKTOP_HEIGHT, DESKTOP_WIDTH } from './contract'
import { webPDimensions } from './webp'

const MAX_OUTPUT_BYTES = 35 * 1024 * 1024
const MAX_SCREENSHOT_BYTES = 25 * 1024 * 1024

export class ComputerUseClientError extends Error {
  constructor(
    message: string,
    readonly code: 'desktop_unavailable' | 'timeout' | 'cancelled' | 'driver_failure' =
      'driver_failure',
  ) {
    super(message)
    this.name = 'ComputerUseClientError'
  }
}

export type ComputerUseClientOptions = {
  executable: string
  displayNumber: number
  arguments?: readonly string[]
  /** Defaults to 120 seconds. Null delegates timeout handling to AbortSignal. */
  timeoutMs?: number | null
  /** Additional environment for the local driver process. */
  environment?: NodeJS.ProcessEnv
  /** Existing directory in which augmented screenshots will be written. */
  temporaryDirectory?: string
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isUint32(value: unknown) {
  return Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 0xffff_ffff
}

function exactFields(value: Record<string, unknown>, allowed: readonly string[]) {
  return Object.keys(value).every((key) => allowed.includes(key))
}

function validCoordinate(value: unknown) {
  return (
    isObject(value) &&
    exactFields(value, ['x', 'y']) &&
    Number.isInteger(value.x) &&
    Number.isInteger(value.y)
  )
}

function parseResponse(value: unknown, request: ExecServerMessage): ExecStreamElement {
  if (!isObject(value)) throw new ComputerUseClientError('Desktop driver returned a non-object response')
  const envelopes = ['exec_client_message', 'exec_client_control_message'].filter((key) => key in value)
  if (envelopes.length !== 1 || !exactFields(value, envelopes)) {
    throw new ComputerUseClientError('Desktop driver response must set exactly one envelope variant')
  }
  if ('exec_client_control_message' in value) {
    const control = value.exec_client_control_message
    if (!isObject(control)) {
      throw new ComputerUseClientError('Desktop driver returned an invalid control response')
    }
    const variants = ['stream_close', 'throw', 'heartbeat'].filter((key) => key in control)
    if (variants.length !== 1 || !isObject(control[variants[0]!])) {
      throw new ComputerUseClientError('Desktop driver control response must set one variant')
    }
    const detail = control[variants[0]!] as Record<string, unknown>
    const controlFields =
      variants[0] === 'throw' ? ['id', 'error', 'stack_trace', 'error_code'] : ['id']
    if (!exactFields(control, variants) || !exactFields(detail, controlFields)) {
      throw new ComputerUseClientError('Desktop driver returned unknown control response fields')
    }
    if (!isUint32(detail.id) || detail.id !== request.id) {
      throw new ComputerUseClientError('Desktop driver control response does not match the request identity')
    }
    if (variants[0] === 'throw' && typeof detail.error !== 'string') {
      throw new ComputerUseClientError('Desktop driver returned an invalid throw response')
    }
    if (
      variants[0] === 'throw' &&
      ((detail.stack_trace !== undefined && typeof detail.stack_trace !== 'string') ||
        (detail.error_code !== undefined && typeof detail.error_code !== 'string'))
    ) {
      throw new ComputerUseClientError('Desktop driver returned invalid optional throw fields')
    }
    return value as ExecStreamElement
  }
  const client = value.exec_client_message
  if (
    !isObject(client) ||
    !exactFields(client, ['id', 'exec_id', 'local_execution_time_ms', 'computer_use_result']) ||
    !isUint32(client.id) ||
    typeof client.exec_id !== 'string'
  ) {
    throw new ComputerUseClientError('Desktop driver returned an invalid client message')
  }
  if (client.id !== request.id || client.exec_id !== request.exec_id) {
    throw new ComputerUseClientError('Desktop driver response does not match the request identity')
  }
  if (
    client.local_execution_time_ms !== undefined &&
    (!Number.isInteger(client.local_execution_time_ms) || Number(client.local_execution_time_ms) < 0)
  ) {
    throw new ComputerUseClientError('Desktop driver returned invalid local execution time')
  }
  const result = client.computer_use_result
  if (
    !isObject(result) ||
    !exactFields(result, ['success', 'error']) ||
    isObject(result.success) === isObject(result.error)
  ) {
    throw new ComputerUseClientError('Desktop driver returned an invalid computer-use result')
  }
  const detail = (result.success ?? result.error) as Record<string, unknown>
  const resultFields = isObject(result.error)
    ? ['error', 'error_code', 'action_count', 'duration_ms', 'log', 'screenshot', 'cursor_position']
    : ['action_count', 'duration_ms', 'log', 'screenshot', 'cursor_position']
  if (!exactFields(detail, resultFields)) {
    throw new ComputerUseClientError('Desktop driver returned unknown computer-use result fields')
  }
  if (
    !Number.isInteger(detail.action_count) ||
    Number(detail.action_count) < 0 ||
    !Number.isInteger(detail.duration_ms) ||
    Number(detail.duration_ms) < 0
  ) {
    throw new ComputerUseClientError('Desktop driver returned invalid execution counters')
  }
  if (isObject(result.error) && typeof result.error.error !== 'string') {
    throw new ComputerUseClientError('Desktop driver returned an invalid error result')
  }
  if (
    detail.error_code !== undefined &&
    !['DESKTOP_UNAVAILABLE', 'DRIVER_FAILURE'].includes(String(detail.error_code))
  ) {
    throw new ComputerUseClientError('Desktop driver returned an invalid error code')
  }
  if (detail.log !== undefined && typeof detail.log !== 'string') {
    throw new ComputerUseClientError('Desktop driver returned an invalid log')
  }
  if (detail.screenshot !== undefined && typeof detail.screenshot !== 'string') {
    throw new ComputerUseClientError('Desktop driver returned an invalid screenshot')
  }
  if (detail.cursor_position !== undefined && !validCoordinate(detail.cursor_position)) {
    throw new ComputerUseClientError('Desktop driver returned an invalid cursor position')
  }
  return value as ExecStreamElement
}

function decodeWebP(value: string) {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4 !== 0) {
    throw new ComputerUseClientError('Desktop driver returned malformed base64 screenshot data')
  }
  const bytes = Buffer.from(value, 'base64')
  if (bytes.length === 0 || bytes.length > MAX_SCREENSHOT_BYTES) {
    throw new ComputerUseClientError('Desktop driver screenshot is empty or exceeds the 25 MB limit')
  }
  const dimensions = webPDimensions(bytes)
  if (!dimensions) {
    throw new ComputerUseClientError('Desktop driver screenshot is not WebP data')
  }
  if (dimensions.width !== DESKTOP_WIDTH || dimensions.height !== DESKTOP_HEIGHT) {
    throw new ComputerUseClientError(
      `Desktop driver screenshot is ${dimensions.width}×${dimensions.height}; expected ${DESKTOP_WIDTH}×${DESKTOP_HEIGHT}`,
    )
  }
  return bytes
}

function screenshotResult(element: ExecStreamElement): ComputerUseSuccess | ComputerUseError | undefined {
  if (!('exec_client_message' in element)) return undefined
  const result = element.exec_client_message.computer_use_result
  return 'success' in result ? result.success : result.error
}

/**
 * Client for the local, one-request-per-process desktop executor.
 *
 * The display is constructor configuration rather than request data so an
 * untrusted tool request cannot select another agent's graphical session.
 */
export class ComputerUseClient implements AsyncDisposable {
  private generatedTemporaryDirectory: Promise<string> | undefined

  constructor(private readonly options: ComputerUseClientOptions) {
    if (!options.executable.trim()) throw new ComputerUseClientError('Desktop driver executable is required')
    if (!Number.isSafeInteger(options.displayNumber) || options.displayNumber < 0 || options.displayNumber > 65_535) {
      throw new ComputerUseClientError('Display number must be between 0 and 65535')
    }
    if (
      options.timeoutMs !== undefined &&
      options.timeoutMs !== null &&
      (!Number.isInteger(options.timeoutMs) || options.timeoutMs <= 0)
    ) {
      throw new ComputerUseClientError('timeoutMs must be a positive integer')
    }
  }

  private async screenshotDirectory() {
    if (this.options.temporaryDirectory) {
      await mkdir(this.options.temporaryDirectory, { recursive: true, mode: 0o700 })
      return this.options.temporaryDirectory
    }
    this.generatedTemporaryDirectory ??= mkdtemp(join(tmpdir(), 'openbot-desktop-driver-'))
    return this.generatedTemporaryDirectory
  }

  private invoke(request: ExecServerMessage, signal?: AbortSignal): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new ComputerUseClientError('Desktop operation was cancelled', 'cancelled'))
        return
      }
      const detached = process.platform !== 'win32'
      const child = spawn(
        this.options.executable,
        [...(this.options.arguments ?? []), '--display-number', String(this.options.displayNumber)],
        {
          detached,
          env: { ...process.env, ...this.options.environment },
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: true,
        },
      )
      let stdout = ''
      let stderr = ''
      let outputBytes = 0
      let settled = false
      let timedOut = false
      let terminating = false
      let forceKill: NodeJS.Timeout | undefined
      const signalProcessTree = (signalName: NodeJS.Signals) => {
        if (detached && child.pid) {
          try {
            process.kill(-child.pid, signalName)
            return
          } catch {
            // The process may have exited between the timer/signal and kill.
          }
        }
        child.kill(signalName)
      }
      const terminate = () => {
        terminating = true
        signalProcessTree('SIGTERM')
        forceKill ??= setTimeout(() => signalProcessTree('SIGKILL'), 500)
        forceKill.unref()
      }
      const timeoutMs = this.options.timeoutMs === undefined ? 120_000 : this.options.timeoutMs
      const timeout =
        timeoutMs === null
          ? undefined
          : setTimeout(() => {
              timedOut = true
              terminate()
            }, timeoutMs)
      timeout?.unref()
      const abort = terminate
      signal?.addEventListener('abort', abort, { once: true })
      const finish = (callback: () => void) => {
        if (settled) return
        settled = true
        if (timeout) clearTimeout(timeout)
        if (forceKill) {
          clearTimeout(forceKill)
          if (terminating) signalProcessTree('SIGKILL')
        }
        signal?.removeEventListener('abort', abort)
        callback()
      }
      child.stdout.setEncoding('utf8')
      child.stderr.setEncoding('utf8')
      child.stdout.on('data', (chunk: string) => {
        outputBytes += Buffer.byteLength(chunk)
        if (outputBytes <= MAX_OUTPUT_BYTES) stdout += chunk
        else terminate()
      })
      child.stderr.on('data', (chunk: string) => {
        if (stderr.length < 8_000) stderr += chunk
      })
      child.once('error', (error) =>
        finish(() =>
          reject(
            new ComputerUseClientError(
              `Could not start desktop driver: ${error.message}`,
              'desktop_unavailable',
            ),
          ),
        ),
      )
      child.once('close', (code, terminationSignal) => {
        finish(() => {
          if (signal?.aborted) {
            reject(new ComputerUseClientError('Desktop operation was cancelled', 'cancelled'))
            return
          }
          if (timedOut) {
            reject(new ComputerUseClientError('Desktop operation timed out', 'timeout'))
            return
          }
          if (outputBytes > MAX_OUTPUT_BYTES) {
            reject(new ComputerUseClientError('Desktop driver response exceeded the 35 MB limit'))
            return
          }
          let parsed: unknown
          try {
            parsed = JSON.parse(stdout)
          } catch {
            const status = terminationSignal
              ? `signal ${terminationSignal}`
              : `exit code ${String(code)}`
            reject(
              new ComputerUseClientError(
                `Desktop driver returned invalid JSON (${status})${stderr.trim() ? `: ${stderr.trim()}` : ''}`,
              ),
            )
            return
          }
          resolve(parsed)
        })
      })
      child.stdin.once('error', () => {})
      child.stdin.end(`${JSON.stringify(request)}\n`)
    })
  }

  async exec(request: ExecServerMessage, signal?: AbortSignal): Promise<ExecStreamElement> {
    if (!isUint32(request.id) || typeof request.exec_id !== 'string' || !request.exec_id) {
      throw new ComputerUseClientError('Request id and exec_id are required')
    }
    const response = parseResponse(await this.invoke(request, signal), request)
    const result = screenshotResult(response)
    if (result?.screenshot !== undefined) {
      const bytes = decodeWebP(result.screenshot)
      const path = join(await this.screenshotDirectory(), `${request.id}-${randomUUID()}.webp`)
      await writeFile(path, bytes, { mode: 0o600, flag: 'wx' })
      result.screenshot_path = path
    }
    return response
  }

  async dispose() {
    if (!this.generatedTemporaryDirectory) return
    const directory = await this.generatedTemporaryDirectory
    this.generatedTemporaryDirectory = undefined
    await rm(directory, { recursive: true, force: true })
  }

  async [Symbol.asyncDispose]() {
    await this.dispose()
  }
}
