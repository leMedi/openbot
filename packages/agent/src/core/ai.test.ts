import assert from 'node:assert/strict'
import test from 'node:test'
import { formatModelReference, parseModelReference } from '../model-reference'

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
