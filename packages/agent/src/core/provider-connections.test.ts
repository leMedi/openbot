import assert from 'node:assert/strict'
import test from 'node:test'
import {
  automaticProviderPrompt,
  combineOpenAIProvider,
  loginProviderId,
  providerCredentialIds,
  usesOpenAIDeviceCode,
} from '../provider-connections'

test('combines OpenAI API-key and Codex subscription connections', () => {
  const providers = combineOpenAIProvider([
    {
      id: 'openai',
      name: 'OpenAI',
      connected: false,
      authMethods: [{ type: 'api_key' as const, label: 'API key' }],
      modelCount: 4,
    },
    {
      id: 'openai-codex',
      name: 'OpenAI Codex',
      connected: true,
      connectionSource: 'stored',
      authMethods: [{ type: 'oauth' as const, label: 'OAuth' }],
      modelCount: 3,
    },
  ])

  assert.deepEqual(providers, [{
    id: 'openai',
    name: 'OpenAI',
    connected: true,
    connectionSource: 'stored',
    authMethods: [
      { type: 'api_key', label: 'API key' },
      { type: 'oauth', label: 'ChatGPT subscription' },
    ],
    modelCount: 7,
  }])
})

test('routes the OpenAI subscription method to Codex', () => {
  assert.equal(loginProviderId('openai', 'oauth'), 'openai-codex')
  assert.equal(loginProviderId('openai', 'api_key'), 'openai')
  assert.deepEqual(providerCredentialIds('openai'), ['openai', 'openai-codex'])
  assert.equal(usesOpenAIDeviceCode('openai', 'oauth'), true)
  assert.equal(usesOpenAIDeviceCode('anthropic', 'oauth'), false)
})

test('does not advertise a subscription method absent from the Codex runtime', () => {
  const [openai] = combineOpenAIProvider([
    {
      id: 'openai',
      name: 'OpenAI',
      connected: false,
      authMethods: [{ type: 'api_key' as const, label: 'API key' }],
      modelCount: 4,
    },
    {
      id: 'openai-codex',
      name: 'OpenAI Codex',
      connected: false,
      authMethods: [],
      modelCount: 3,
    },
  ])
  assert.deepEqual(openai?.authMethods, [{ type: 'api_key', label: 'API key' }])
})

test('automatically selects device-code login for Codex subscriptions', () => {
  assert.equal(automaticProviderPrompt('openai-codex', 'oauth', {
    type: 'select',
    message: 'Choose a login method',
    options: [
      { id: 'browser', label: 'Browser' },
      { id: 'device_code', label: 'Device code' },
    ],
  }), 'device_code')
})

test('does not answer unrelated provider prompts', () => {
  assert.equal(automaticProviderPrompt('anthropic', 'oauth', {
    type: 'select',
    message: 'Choose a login method',
    options: [{ id: 'device_code', label: 'Device code' }],
  }), undefined)
})
