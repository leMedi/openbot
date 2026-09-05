import { mkdirSync } from 'node:fs'
import path from 'node:path'
import type { Api, Model } from '@earendil-works/pi-ai'
import { ModelRuntime } from '@earendil-works/pi-coding-agent'
import { dataDirectory } from '@openbot/db'
import { formatModelReference, parseModelReference } from './model-reference'

export * from './model-reference'

export const OPENBOT_PROVIDER_ID = 'openbot'

export type ProviderAuthMethodDto = {
  type: 'api_key' | 'oauth'
  label: string
}

export type ProviderDto = {
  id: string
  name: string
  connected: boolean
  connectionSource?: string
  authMethods: ProviderAuthMethodDto[]
  modelCount: number
}

export type ModelDto = {
  key: string
  provider: string
  providerName: string
  id: string
  name: string
  reasoning: boolean
  input: ('text' | 'image')[]
  contextWindow: number
  maxTokens: number
  cost: {
    input: number
    output: number
    cacheRead: number
    cacheWrite: number
  }
}

export type ProviderConfigurationDto = {
  providers: ProviderDto[]
  models: ModelDto[]
  error?: string
}

/** Pi keeps credentials and catalog caches inside OpenBot's managed data directory. */
export function piAgentDirectory() {
  const directory = path.join(dataDirectory, 'pi-agent')
  mkdirSync(directory, { recursive: true })
  return directory
}

function legacyProviderConfig() {
  const baseUrl = process.env.OPENBOT_AI_BASE_URL?.replace(/\/+$/, '')
  const apiKey = process.env.OPENBOT_AI_API_KEY
  const model = process.env.OPENBOT_AI_MODEL
  if (!baseUrl || !apiKey || !model) return undefined
  return { baseUrl, model }
}

let runtimePromise: Promise<ModelRuntime> | undefined

/** The one process-wide Pi model and credential runtime used by management and turns. */
export function getModelRuntime(): Promise<ModelRuntime> {
  runtimePromise ??= (async () => {
    const agentDir = piAgentDirectory()
    const runtime = await ModelRuntime.create({
      authPath: path.join(agentDir, 'auth.json'),
      modelsPath: path.join(agentDir, 'models.json'),
      modelsStorePath: path.join(agentDir, 'models-store.json'),
      allowModelNetwork: false,
    })

    // Preserve existing installations as an in-memory custom provider while
    // moving built-in providers and stored Pi credentials to the primary path.
    const legacy = legacyProviderConfig()
    if (legacy) {
      runtime.registerProvider(OPENBOT_PROVIDER_ID, {
        name: 'OpenBot endpoint',
        baseUrl: legacy.baseUrl,
        api: 'openai-completions',
        apiKey: '$OPENBOT_AI_API_KEY',
        models: [
          {
            id: legacy.model,
            name: legacy.model,
            reasoning: false,
            input: ['text', 'image'],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 128_000,
            maxTokens: 16_384,
          },
        ],
      })
    }
    return runtime
  })()
  return runtimePromise
}

function toModelDto(
  model: Model<Api>,
  providerName: string,
): ModelDto {
  return {
    key: formatModelReference({ provider: model.provider, modelId: model.id }),
    provider: model.provider,
    providerName,
    id: model.id,
    name: model.name,
    reasoning: model.reasoning,
    input: [...model.input],
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens,
    cost: { ...model.cost },
  }
}

/** Safe, serializable provider state for clients. Credentials never cross this boundary. */
export async function getProviderConfiguration(): Promise<ProviderConfigurationDto> {
  const runtime = await getModelRuntime()
  const providers = runtime.getProviders()
  let availabilityFailed = false
  const signal = AbortSignal.timeout(10_000)
  const available = (await Promise.all(providers.map(async (provider) => {
    try {
      return await runtime.getAvailable(provider.id, { signal })
    } catch {
      availabilityFailed = true
      return runtime.getAvailableSnapshot().filter((model) => model.provider === provider.id)
    }
  }))).flat()
  const providerNames = new Map(providers.map((provider) => [provider.id, provider.name]))
  const modelCount = new Map<string, number>()
  for (const model of runtime.getModels()) {
    modelCount.set(model.provider, (modelCount.get(model.provider) ?? 0) + 1)
  }

  return {
    providers: providers
      .map((provider) => {
        const status = runtime.getProviderAuthStatus(provider.id)
        const authMethods: ProviderAuthMethodDto[] = []
        if (provider.auth.apiKey?.login) {
          authMethods.push({ type: 'api_key', label: provider.auth.apiKey.name })
        }
        if (provider.auth.oauth) {
          authMethods.push({
            type: 'oauth',
            label: provider.auth.oauth.loginLabel ?? provider.auth.oauth.name,
          })
        }
        return {
          id: provider.id,
          name: provider.name,
          connected: status.configured,
          connectionSource: status.source,
          authMethods,
          modelCount: modelCount.get(provider.id) ?? 0,
        }
      })
      .sort((left, right) => left.name.localeCompare(right.name)),
    models: available
      .map((model) => toModelDto(model, providerNames.get(model.provider) ?? model.provider))
      .sort((left, right) =>
        left.providerName.localeCompare(right.providerName) || left.name.localeCompare(right.name),
      ),
    error: availabilityFailed || runtime.getError()
      ? 'Some provider status checks failed. Cached provider and model data is shown.'
      : undefined,
  }
}

/** Resolve a persisted provider/model key against the current authenticated catalog. */
export async function resolveAvailableModel(
  value: string,
): Promise<{ runtime: ModelRuntime; model: Model<Api> } | undefined> {
  const runtime = await getModelRuntime()
  const parsed = parseModelReference(value)
  if (parsed) {
    const model = runtime.getModel(parsed.provider, parsed.modelId)
    const available = await runtime.getAvailable(parsed.provider)
    return model && available.some((candidate) =>
      candidate.provider === model.provider && candidate.id === model.id
    )
      ? { runtime, model }
      : undefined
  }

  // Older rows stored an unqualified model id. Resolve it only when unique.
  const matches = runtime.getModels().filter((model) => model.id === value)
  if (matches.length !== 1) return undefined
  const [model] = matches
  const available = await runtime.getAvailable(model.provider)
  return available.some((candidate) => candidate.id === model.id)
    ? { runtime, model }
    : undefined
}

/** Resolve canonical references and matching legacy IDs without substituting another model. */
export async function resolveConfiguredModel(value: string) {
  const resolved = await resolveAvailableModel(value)
  if (resolved || value.includes('/')) return resolved
  const legacy = await resolveLegacyModel()
  return legacy?.model.id === value ? legacy : undefined
}

/** Resolve a reference against the full catalog without requiring credentials. */
export async function resolveKnownModel(value: string): Promise<Model<Api> | undefined> {
  const runtime = await getModelRuntime()
  const parsed = parseModelReference(value)
  if (parsed) return runtime.getModel(parsed.provider, parsed.modelId)
  const matches = runtime.getModels().filter((model) => model.id === value)
  return matches.length === 1 ? matches[0] : undefined
}

export async function canonicalAvailableModelReference(value: string) {
  const resolved = await resolveAvailableModel(value)
  return resolved
    ? formatModelReference({
        provider: resolved.model.provider,
        modelId: resolved.model.id,
      })
    : undefined
}

/** Temporary fallback used while an installation still relies on OPENBOT_AI_* variables. */
export async function resolveLegacyModel() {
  const legacy = legacyProviderConfig()
  if (!legacy) return undefined
  return resolveAvailableModel(formatModelReference({
    provider: OPENBOT_PROVIDER_ID,
    modelId: legacy.model,
  }))
}
