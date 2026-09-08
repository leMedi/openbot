import { cp, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import type {
  ApiProvider,
  CallApiContextParams,
  ProviderOptions,
  ProviderResponse,
} from 'promptfoo'
import type { EvalAgentConfig, OpenBotEvalMetadata } from './types'

type OpenBotProviderConfig = {
  agent: EvalAgentConfig
  sourceDataDir?: string
  timeoutMs?: number
}

type WorkerResult = {
  output: string
  metadata: OpenBotEvalMetadata
}

const providerDirectory = path.dirname(fileURLToPath(import.meta.url))
const workspaceRoot = path.resolve(providerDirectory, '../../..')
const workerPath = path.join(providerDirectory, 'run-scenario.ts')
const tsxLoader = createRequire(import.meta.url).resolve('tsx')
const providerFiles = ['auth.json', 'models.json', 'models-store.json']

async function copyProviderState(sourceDataDir: string, targetDataDir: string) {
  const source = path.join(sourceDataDir, 'pi-agent')
  const target = path.join(targetDataDir, 'pi-agent')
  await mkdir(target, { recursive: true })
  for (const name of providerFiles) {
    await cp(path.join(source, name), path.join(target, name), {
      force: false,
      errorOnExist: true,
    }).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error
    })
  }
}

function executeWorker(
  input: { agent: EvalAgentConfig; message: string },
  dataDirectory: string,
  timeoutMs: number,
): Promise<WorkerResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', tsxLoader, workerPath], {
      cwd: workspaceRoot,
      env: {
        ...process.env,
        OPENBOT_DATA_DIR: dataDirectory,
        OPENBOT_DESKTOP_MODE: 'disabled',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs)

    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk))
    child.once('error', reject)
    child.once('close', (code, signal) => {
      clearTimeout(timer)
      const output = Buffer.concat(stdout).toString('utf8')
      const diagnostics = Buffer.concat(stderr).toString('utf8').trim()
      if (code !== 0) {
        reject(new Error(
          `OpenBot eval worker failed ${signal ? `with ${signal}` : `with exit code ${code}`}\n${diagnostics}`,
        ))
        return
      }
      try {
        resolve(JSON.parse(output) as WorkerResult)
      } catch {
        reject(new Error(`OpenBot eval worker returned invalid JSON\n${diagnostics}`))
      }
    })
    child.stdin.end(JSON.stringify(input))
  })
}

export default class OpenBotProvider implements ApiProvider {
  private readonly providerId: string
  readonly config: OpenBotProviderConfig

  constructor(options: ProviderOptions) {
    this.providerId = options.id ?? 'openbot-agent'
    this.config = options.config as OpenBotProviderConfig
  }

  id() {
    return this.providerId
  }

  async callApi(
    prompt: string,
    _context?: CallApiContextParams,
  ): Promise<ProviderResponse> {
    const dataDirectory = await mkdtemp(path.join(tmpdir(), 'openbot-agent-eval-'))
    const sourceDataDir = path.resolve(
      workspaceRoot,
      this.config.sourceDataDir ?? process.env.OPENBOT_DATA_DIR ?? '.data',
    )

    try {
      await copyProviderState(sourceDataDir, dataDirectory)
      const result = await executeWorker(
        { agent: this.config.agent, message: prompt },
        dataDirectory,
        this.config.timeoutMs ?? 5 * 60_000,
      )
      return {
        output: result.output,
        metadata: result.metadata,
      }
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : 'OpenBot eval failed',
      }
    } finally {
      await rm(dataDirectory, { recursive: true, force: true })
    }
  }
}
