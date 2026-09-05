import { randomUUID } from 'node:crypto'
import type { AuthEvent, AuthPrompt, AuthType } from '@earendil-works/pi-ai'
import { getModelRuntime, getProviderConfiguration } from './ai'

export type ProviderAuthPromptDto =
  | { type: 'text'; message: string; placeholder?: string }
  | { type: 'secret'; message: string; placeholder?: string }
  | {
      type: 'select'
      message: string
      options: readonly { id: string; label: string; description?: string }[]
    }
  | { type: 'manual_code'; message: string; placeholder?: string }

export type ProviderAuthFlowEvent =
  | { type: 'prompt'; promptId: string; prompt: ProviderAuthPromptDto }
  | { type: 'prompt_answered'; promptId: string }
  | { type: 'notification'; notification: AuthEvent }
  | { type: 'complete' }
  | { type: 'error'; message: string }

type PendingPrompt = {
  id: string
  resolve(value: string): void
  reject(error: Error): void
}

type AuthFlow = {
  id: string
  providerId: string
  controller: AbortController
  events: ProviderAuthFlowEvent[]
  subscribers: Set<(event: ProviderAuthFlowEvent) => void>
  pending?: PendingPrompt
  terminal: boolean
}

const flows = new Map<string, AuthFlow>()
const activeProviderFlows = new Map<string, string>()

function emit(flow: AuthFlow, event: ProviderAuthFlowEvent) {
  flow.events.push(event)
  if (event.type === 'complete' || event.type === 'error') flow.terminal = true
  for (const subscriber of flow.subscribers) subscriber(event)
}

function serializablePrompt(prompt: AuthPrompt): ProviderAuthPromptDto {
  if (prompt.type === 'select') {
    return { type: prompt.type, message: prompt.message, options: prompt.options }
  }
  return {
    type: prompt.type,
    message: prompt.message,
    placeholder: prompt.placeholder,
  }
}

function waitForPrompt(flow: AuthFlow, prompt: AuthPrompt): Promise<string> {
  if (flow.pending) throw new Error('The provider requested overlapping login prompts')
  const promptId = `prm_${randomUUID()}`

  return new Promise((resolve, reject) => {
    const onAbort = () => {
      if (flow.pending?.id !== promptId) return
      flow.pending = undefined
      reject(new Error('Provider login was cancelled'))
    }
    const finish = (value: string) => {
      prompt.signal?.removeEventListener('abort', onAbort)
      flow.controller.signal.removeEventListener('abort', onAbort)
      resolve(value)
    }
    const fail = (error: Error) => {
      prompt.signal?.removeEventListener('abort', onAbort)
      flow.controller.signal.removeEventListener('abort', onAbort)
      reject(error)
    }
    flow.pending = { id: promptId, resolve: finish, reject: fail }
    prompt.signal?.addEventListener('abort', onAbort, { once: true })
    flow.controller.signal.addEventListener('abort', onAbort, { once: true })
    if (prompt.signal?.aborted || flow.controller.signal.aborted) {
      onAbort()
    } else {
      emit(flow, { type: 'prompt', promptId, prompt: serializablePrompt(prompt) })
    }
  })
}

/** Start the same provider-owned flow used by pi's /login command. */
export async function beginProviderLogin(providerId: string, authType: AuthType) {
  const runtime = await getModelRuntime()
  const provider = runtime.getProvider(providerId)
  if (!provider) throw new Error(`Unknown provider: ${providerId}`)
  if (activeProviderFlows.has(providerId)) {
    throw new Error(`A login for ${provider.name} is already in progress`)
  }
  if (authType === 'api_key' && !provider.auth.apiKey?.login) {
    throw new Error(`${provider.name} cannot configure an API key interactively`)
  }
  if (authType === 'oauth' && !provider.auth.oauth) {
    throw new Error(`${provider.name} does not support OAuth`)
  }

  const flow: AuthFlow = {
    id: `paf_${randomUUID()}`,
    providerId,
    controller: new AbortController(),
    events: [],
    subscribers: new Set(),
    terminal: false,
  }
  flows.set(flow.id, flow)
  activeProviderFlows.set(providerId, flow.id)

  void (async () => {
    try {
      await runtime.login(providerId, authType, {
        signal: flow.controller.signal,
        prompt: (prompt) => waitForPrompt(flow, prompt),
        notify: (notification) => emit(flow, { type: 'notification', notification }),
      })

      const refreshController = new AbortController()
      const timeout = setTimeout(() => refreshController.abort(), 15_000)
      try {
        const signal = AbortSignal.any([flow.controller.signal, refreshController.signal])
        const refreshed = await runtime.refresh({
          providers: [providerId],
          allowNetwork: true,
          force: true,
          signal,
        })
        const error = refreshed.errors.get(providerId)
        if (error) {
          emit(flow, {
            type: 'notification',
            notification: {
              type: 'info',
              message: 'Connected, but the latest model catalog could not be loaded.',
            },
          })
        }
        if (flow.controller.signal.aborted) {
          throw new Error('Provider login was cancelled')
        }
        if (refreshed.aborted) {
          emit(flow, {
            type: 'notification',
            notification: {
              type: 'info',
              message: 'Connected, but the model catalog refresh timed out. Cached models are shown.',
            },
          })
        }
      } finally {
        clearTimeout(timeout)
      }
      emit(flow, { type: 'complete' })
    } catch {
      emit(flow, {
        type: 'error',
        message: flow.controller.signal.aborted
          ? 'Provider login was cancelled'
          : 'Provider login failed. Check the supplied credentials and try again.',
      })
    } finally {
      flow.pending?.reject(new Error('Provider login ended before the prompt was answered'))
      flow.pending = undefined
      activeProviderFlows.delete(providerId)
      const cleanup = setTimeout(() => flows.delete(flow.id), 10 * 60_000)
      cleanup.unref()
    }
  })()

  return { flowId: flow.id }
}

export function respondToProviderLogin(flowId: string, promptId: string, value: string) {
  const flow = flows.get(flowId)
  if (!flow) throw new Error('Provider login flow was not found')
  if (!flow.pending || flow.pending.id !== promptId) {
    throw new Error('This provider login prompt is no longer active')
  }
  const pending = flow.pending
  flow.pending = undefined
  emit(flow, { type: 'prompt_answered', promptId })
  pending.resolve(value)
}

export function cancelProviderLogin(flowId: string) {
  const flow = flows.get(flowId)
  if (!flow) return
  flow.controller.abort()
}

export async function watchProviderLogin(
  flowId: string,
  listener: (event: ProviderAuthFlowEvent) => void,
  signal: AbortSignal,
) {
  const flow = flows.get(flowId)
  if (!flow) throw new Error('Provider login flow was not found')
  for (const event of flow.events) listener(event)
  if (flow.terminal || signal.aborted) return

  await new Promise<void>((resolve) => {
    const subscriber = (event: ProviderAuthFlowEvent) => {
      listener(event)
      if (event.type === 'complete' || event.type === 'error') finish()
    }
    const finish = () => {
      flow.subscribers.delete(subscriber)
      signal.removeEventListener('abort', finish)
      resolve()
    }
    flow.subscribers.add(subscriber)
    signal.addEventListener('abort', finish, { once: true })
  })
}

export async function disconnectProvider(providerId: string) {
  const runtime = await getModelRuntime()
  await runtime.logout(providerId)
  return getProviderConfiguration()
}

export async function refreshProviderModels(providerId?: string) {
  const runtime = await getModelRuntime()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15_000)
  try {
    const result = await runtime.refresh({
      providers: providerId ? [providerId] : undefined,
      allowNetwork: true,
      force: true,
      signal: controller.signal,
    })
    if (result.aborted) throw new Error('Model catalog refresh timed out')
    if (result.errors.size > 0) {
      throw new Error('One or more model catalogs could not be refreshed')
    }
  } catch {
    throw new Error('Model catalogs could not be refreshed')
  } finally {
    clearTimeout(timeout)
  }
  return getProviderConfiguration()
}
