import { executeComputerUse, systemDependencies } from './executor'
import type { ExecServerMessage, ExecStreamElement } from './contract'

const MAX_INPUT_BYTES = 2 * 1024 * 1024
const DISPLAY_NUMBER_MAX = 65_535

function usageError(message: string) {
  return new Error(`${message}\nUsage: openbot-desktop-driver --display-number <number>`)
}

function validateRequestFields(request: Record<string, unknown>) {
  const allowed = new Set([
    'id',
    'exec_id',
    'computer_use_args',
    'span_context',
    'accept_hook_additional_contexts',
  ])
  const unknown = Object.keys(request).filter((key) => !allowed.has(key))
  if (unknown.length > 0) throw new Error(`Request contains unknown field: ${unknown.join(', ')}`)
  if (!request.computer_use_args || typeof request.computer_use_args !== 'object' || Array.isArray(request.computer_use_args)) {
    throw new Error('computer_use_args must be an object')
  }
  if (request.span_context !== undefined && (!request.span_context || typeof request.span_context !== 'object' || Array.isArray(request.span_context))) {
    throw new Error('span_context must be an object')
  }
  if (
    request.accept_hook_additional_contexts !== undefined &&
    typeof request.accept_hook_additional_contexts !== 'boolean'
  ) {
    throw new Error('accept_hook_additional_contexts must be a boolean')
  }
}

export function parseDisplayNumber(arguments_: readonly string[]) {
  if (arguments_.length !== 2 || arguments_[0] !== '--display-number') {
    throw usageError('Expected --display-number followed by one display number')
  }
  const value = arguments_[1]!
  if (!/^(0|[1-9]\d*)$/.test(value)) throw usageError('Display number must be a non-negative integer')
  const displayNumber = Number(value)
  if (!Number.isSafeInteger(displayNumber) || displayNumber > DISPLAY_NUMBER_MAX) {
    throw usageError(`Display number must be between 0 and ${DISPLAY_NUMBER_MAX}`)
  }
  return displayNumber
}

async function readInput() {
  const chunks: Buffer[] = []
  let bytes = 0
  for await (const chunk of process.stdin) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    bytes += buffer.length
    if (bytes > MAX_INPUT_BYTES) throw new Error('Desktop driver request exceeds the 2 MB limit')
    chunks.push(buffer)
  }
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Desktop driver request must be a JSON object')
  }
  return parsed as ExecServerMessage
}

async function main() {
  let request: ExecServerMessage | undefined
  const controller = new AbortController()
  const abort = () => controller.abort(new Error('Desktop driver was terminated'))
  process.once('SIGINT', abort)
  process.once('SIGTERM', abort)
  try {
    const displayNumber = parseDisplayNumber(process.argv.slice(2))
    request = await readInput()
    validateRequestFields(request as unknown as Record<string, unknown>)
    if (!Number.isInteger(request.id) || request.id < 0 || request.id > 0xffff_ffff) {
      throw new Error('id must be a uint32')
    }
    if (typeof request.exec_id !== 'string' || !request.exec_id) throw new Error('exec_id is required')
    const result = await executeComputerUse(
      request.computer_use_args,
      systemDependencies(displayNumber, controller.signal),
    )
    const response: ExecStreamElement = {
      exec_client_message: {
        id: request.id,
        exec_id: request.exec_id,
        local_execution_time_ms:
          'success' in result ? result.success.duration_ms : result.error.duration_ms,
        computer_use_result: result,
      },
    }
    process.stdout.write(`${JSON.stringify(response)}\n`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const response: ExecStreamElement = {
      exec_client_control_message: {
        throw: {
          id: request && Number.isInteger(request.id) ? request.id : 0,
          error: message,
          error_code: 'INVALID_REQUEST',
        },
      },
    }
    process.stdout.write(`${JSON.stringify(response)}\n`)
    process.exitCode = 1
  } finally {
    process.removeListener('SIGINT', abort)
    process.removeListener('SIGTERM', abort)
  }
}

void main()
