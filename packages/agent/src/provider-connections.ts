import type { AuthPrompt, AuthType } from '@earendil-works/pi-ai'

export const OPENAI_PROVIDER_ID = 'openai'
export const OPENAI_CODEX_PROVIDER_ID = 'openai-codex'

type ProviderConnection = {
  id: string
  name: string
  connected: boolean
  connectionSource?: string
  authMethods: { type: AuthType; label: string }[]
  modelCount: number
}

export function combineOpenAIProvider<T extends ProviderConnection>(providers: T[]): T[] {
  const openai = providers.find((provider) => provider.id === OPENAI_PROVIDER_ID)
  const codex = providers.find((provider) => provider.id === OPENAI_CODEX_PROVIDER_ID)
  if (!openai || !codex) return providers

  const combined: T = {
    ...openai,
    name: 'OpenAI',
    connected: openai.connected || codex.connected,
    connectionSource: [openai.connectionSource, codex.connectionSource].includes('stored')
      ? 'stored'
      : openai.connectionSource ?? codex.connectionSource,
    modelCount: openai.modelCount + codex.modelCount,
    authMethods: [
      ...openai.authMethods.filter((method) => method.type === 'api_key'),
      ...codex.authMethods
        .filter((method) => method.type === 'oauth')
        .map(() => ({ type: 'oauth' as const, label: 'ChatGPT subscription' })),
    ],
  }
  return providers.flatMap((provider) => {
    if (provider.id === OPENAI_CODEX_PROVIDER_ID) return []
    return [provider.id === OPENAI_PROVIDER_ID ? combined : provider]
  })
}

/** OpenBot presents Pi's API and subscription integrations as one OpenAI provider. */
export function providerCredentialIds(providerId: string): string[] {
  return providerId === OPENAI_PROVIDER_ID
    ? [OPENAI_PROVIDER_ID, OPENAI_CODEX_PROVIDER_ID]
    : [providerId]
}

export function loginProviderId(providerId: string, authType: AuthType) {
  return providerId === OPENAI_PROVIDER_ID && authType === 'oauth'
    ? OPENAI_CODEX_PROVIDER_ID
    : providerId
}

export function usesOpenAIDeviceCode(providerId: string, authType: AuthType) {
  return authType === 'oauth'
    && (providerId === OPENAI_PROVIDER_ID || providerId === OPENAI_CODEX_PROVIDER_ID)
}

/** The remote-machine-safe OpenAI subscription flow skips Pi's browser/device picker. */
export function automaticProviderPrompt(
  providerId: string,
  authType: AuthType,
  prompt: AuthPrompt,
): string | undefined {
  if (
    providerId === OPENAI_CODEX_PROVIDER_ID
    && usesOpenAIDeviceCode(providerId, authType)
    && prompt.type === 'select'
    && prompt.options.some((option) => option.id === 'device_code')
  ) {
    return 'device_code'
  }
  return undefined
}
