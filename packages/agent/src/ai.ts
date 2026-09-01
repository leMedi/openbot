// Inference runs through the pi SDK. This module registers the configured
// OpenAI-compatible endpoint as a pi provider and owns the shared
// ModelRuntime; the turn runner creates one AgentSession per turn and pi
// drives the completion/tool loop.

import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { Api, Model } from '@earendil-works/pi-ai'
import { ModelRuntime } from '@earendil-works/pi-coding-agent'
import { dataDirectory } from '@openbot/db'

// Inference goes through one OpenAI-compatible chat-completions endpoint
// fixed by server configuration; there is no per-agent provider selection yet.
export type AiConfig = {
  baseUrl: string
  apiKey: string
  model: string
}

export function getAiConfig(): AiConfig {
  const baseUrl = process.env.OPENBOT_AI_BASE_URL
  const apiKey = process.env.OPENBOT_AI_API_KEY
  const model = process.env.OPENBOT_AI_MODEL
  if (!baseUrl || !apiKey || !model) {
    throw new Error(
      'OPENBOT_AI_BASE_URL, OPENBOT_AI_API_KEY, and OPENBOT_AI_MODEL must be configured',
    )
  }
  return { baseUrl: baseUrl.replace(/\/+$/, ''), apiKey, model }
}

export const OPENBOT_PROVIDER_ID = 'openbot'

/** Pi keeps its config (models.json, auth.json) here instead of ~/.pi/agent. */
export function piAgentDirectory() {
  const directory = path.join(dataDirectory, 'pi-agent')
  mkdirSync(directory, { recursive: true })
  return directory
}

/** Per-conversation pi session storage; each turn continues the stored session. */
export function piSessionDirectory(conversationId: string) {
  const directory = path.join(dataDirectory, 'pi-sessions', conversationId)
  mkdirSync(directory, { recursive: true })
  return directory
}

/**
 * Registers the configured endpoint as a pi provider. The API key stays an
 * environment-variable reference so the credential never lands on disk.
 */
function writeModelsConfig(config: AiConfig) {
  const modelsPath = path.join(piAgentDirectory(), 'models.json')
  writeFileSync(
    modelsPath,
    JSON.stringify(
      {
        providers: {
          [OPENBOT_PROVIDER_ID]: {
            name: 'OpenBot endpoint',
            baseUrl: config.baseUrl,
            api: 'openai-completions',
            apiKey: '$OPENBOT_AI_API_KEY',
            models: [{ id: config.model, name: config.model }],
          },
        },
      },
      null,
      2,
    ),
  )
  return modelsPath
}

// One runtime per process, isolated from any ~/.pi installation on the machine.
let runtimePromise: Promise<ModelRuntime> | undefined

async function getModelRuntime(config: AiConfig): Promise<ModelRuntime> {
  runtimePromise ??= ModelRuntime.create({
    authPath: path.join(piAgentDirectory(), 'auth.json'),
    modelsPath: writeModelsConfig(config),
    refreshOnCreate: false,
  })
  return runtimePromise
}

/** The runtime plus the configured model, resolved from the provider registry. */
export async function getOpenbotModel(
  config: AiConfig,
): Promise<{ runtime: ModelRuntime; model: Model<Api> }> {
  const runtime = await getModelRuntime(config)
  const model = runtime.getModel(OPENBOT_PROVIDER_ID, config.model)
  if (!model) {
    throw new Error(
      `Model ${config.model} is not registered for provider ${OPENBOT_PROVIDER_ID}`,
    )
  }
  return { runtime, model }
}
