import {
  disconnectProvider,
  canonicalAvailableModelReference,
  getProviderConfiguration,
  refreshProviderModels,
  resolveKnownModel,
} from '@openbot/agent'
import {
  getSetting,
  listAgents,
  updateSettingModels,
} from '@openbot/db'
import { createServerFn } from '@tanstack/react-start'
import * as z from 'zod'

const modelKey = z.string().trim().min(3).max(512)

export const getAiProviders = createServerFn({ method: 'GET' }).handler(async () => {
  const [catalog, setting] = await Promise.all([
    getProviderConfiguration(),
    getSetting(),
  ])
  return { ...catalog, setting }
})

export const saveAiModelSettings = createServerFn({ method: 'POST' })
  .validator((input: unknown) => z.object({
    defaultAgentModel: modelKey,
    orchestratorModel: modelKey,
  }).parse(input))
  .handler(async ({ data }) => {
    const [defaultAgentModel, orchestratorModel] = await Promise.all([
      canonicalAvailableModelReference(data.defaultAgentModel),
      canonicalAvailableModelReference(data.orchestratorModel),
    ])
    if (!defaultAgentModel) throw new Error(`Model ${data.defaultAgentModel} is not available`)
    if (!orchestratorModel) throw new Error(`Model ${data.orchestratorModel} is not available`)
    return updateSettingModels({ defaultAgentModel, orchestratorModel })
  })

export const disconnectAiProvider = createServerFn({ method: 'POST' })
  .validator((input: unknown) => z.object({ providerId: z.string().min(1) }).parse(input))
  .handler(async ({ data }) => {
    const [setting, agents] = await Promise.all([getSetting(), listAgents()])
    const references = [
      { label: 'default agent model', value: setting.defaultAgentModel },
      { label: 'orchestrator model', value: setting.orchestratorModel },
      ...agents.flatMap((agent) => agent.defaultModel
        ? [{ label: `model for ${agent.name}`, value: agent.defaultModel }]
        : []),
    ]
    const resolvedReferences = await Promise.all(references.map(async (reference) => ({
      ...reference,
      model: await resolveKnownModel(reference.value),
    })))
    const usedBy = resolvedReferences
      .filter(({ model }) => model?.provider === data.providerId)
      .map(({ label }) => label)
    if (usedBy.length > 0) {
      throw new Error(`Choose replacement models before disconnecting; this provider is used by ${usedBy.join(', ')}`)
    }
    return disconnectProvider(data.providerId)
  })

export const refreshAiProviders = createServerFn({ method: 'POST' })
  .validator((input: unknown) => z.object({ providerId: z.string().min(1).optional() }).parse(input))
  .handler(({ data }) => refreshProviderModels(data.providerId))
