import assert from 'node:assert/strict'
import test from 'node:test'
import { formatModelReference, parseModelReference } from '../model-reference'
import { openCodeSessionHeaders } from '../provider-session'

test('model references preserve model ids containing slashes', () => {
  const value = formatModelReference({
    provider: 'openrouter',
    modelId: 'anthropic/claude-sonnet-4.6',
  })

  assert.equal(value, 'openrouter/anthropic/claude-sonnet-4.6')
  assert.deepEqual(parseModelReference(value), {
    provider: 'openrouter',
    modelId: 'anthropic/claude-sonnet-4.6',
  })
})

test('model references reject unqualified and incomplete values', () => {
  assert.equal(parseModelReference('gpt-5'), undefined)
  assert.equal(parseModelReference('/gpt-5'), undefined)
  assert.equal(parseModelReference('openai/'), undefined)
})

test('adds a stable routing session for OpenCode requests only', () => {
  const expected = {
    'x-opencode-session': 'cnv_group',
    'x-opencode-client': 'openbot',
  }

  assert.deepEqual(
    openCodeSessionHeaders(
      { provider: 'opencode-go', baseUrl: 'https://opencode.ai/zen/go/v1' },
      'cnv_group',
    ),
    expected,
  )
  assert.deepEqual(
    openCodeSessionHeaders(
      { provider: 'custom', baseUrl: 'https://opencode.ai/zen/go/v1' },
      'cnv_group',
    ),
    expected,
  )
  assert.equal(
    openCodeSessionHeaders(
      { provider: 'openai', baseUrl: 'https://api.openai.com/v1' },
      'cnv_group',
    ),
    undefined,
  )
})
