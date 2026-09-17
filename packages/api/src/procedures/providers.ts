import {
  disconnectProvider,
  canonicalAvailableModelReference,
  getProviderConfiguration,
  type ProviderAuthFlowEvent,
  refreshProviderModels,
  resolveKnownModel,
  watchProviderLogin,
} from '@openbot/agent'
import { getSetting, listAgents, updateSettingModels } from '@openbot/db'
import * as z from 'zod'
import { badRequest, base } from '../base'
import { fromWatcher } from '../watch'

const modelKey = z.string().trim().min(3).max(512)

export const providers = {
  list: base.handler(async () => {
    const [catalog, setting] = await Promise.all([getProviderConfiguration(), getSetting()])
    return { ...catalog, setting }
  }),

  saveModelSettings: base
    .input(z.object({ defaultAgentModel: modelKey, orchestratorModel: modelKey }))
    .handler(async ({ input }) => {
      const [defaultAgentModel, orchestratorModel] = await Promise.all([
        canonicalAvailableModelReference(input.defaultAgentModel),
        canonicalAvailableModelReference(input.orchestratorModel),
      ])
      if (!defaultAgentModel) throw badRequest(`Model ${input.defaultAgentModel} is not available`)
      if (!orchestratorModel) throw badRequest(`Model ${input.orchestratorModel} is not available`)
      return updateSettingModels({ defaultAgentModel, orchestratorModel })
    }),

  disconnect: base
    .input(z.object({ providerId: z.string().min(1) }))
    .handler(async ({ input }) => {
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
        .filter(({ model }) => model?.provider === input.providerId)
        .map(({ label }) => label)
      if (usedBy.length > 0) {
        throw badRequest(`Choose replacement models before disconnecting; this provider is used by ${usedBy.join(', ')}`)
      }
      return disconnectProvider(input.providerId)
    }),

  refresh: base
    .input(z.object({ providerId: z.string().min(1).optional() }))
    .handler(({ input }) => refreshProviderModels(input.providerId)),

  /**
   * Streams one provider login flow's prompts, notifications, and terminal
   * `complete` or `error`. A failure to attach is reported as an `error`
   * event so the dialog shows it inline, matching the flow's own errors.
   */
  watchLogin: base
    .input(z.object({ flowId: z.string().min(1) }))
    .handler(async function* ({ input, signal }): AsyncGenerator<ProviderAuthFlowEvent> {
      try {
        yield* fromWatcher<ProviderAuthFlowEvent>(
          (onEvent, watchSignal) => watchProviderLogin(input.flowId, onEvent, watchSignal),
          signal,
        )
      } catch (cause) {
        yield {
          type: 'error',
          message: cause instanceof Error ? cause.message : 'Provider login stream failed',
        }
      }
    }),
}
