import assert from 'node:assert/strict'
import test from 'node:test'
import type { Bot } from './data'
import {
  matchingConversationAgents,
  MAX_GROUP_NAME_LENGTH,
  namedConversationGroup,
} from './new-conversation-model'

const agents: Bot[] = [
  { id: 'a', name: 'Alice', color: '#111', shape: 'circle', model: '', prompt: '', grants: [], memory: '' },
  { id: 'b', name: 'Bob', color: '#222', shape: 'circle', model: '', prompt: '', grants: [], memory: '' },
  { id: 'c', name: 'Research', color: '#333', shape: 'circle', model: '', prompt: '', grants: [], memory: '' },
]

test('filters agents by name and excludes selected agents', () => {
  assert.deepEqual(
    matchingConversationAgents(agents, ['a'], 'B').map((agent) => agent.id),
    ['b'],
  )
  assert.deepEqual(
    matchingConversationAgents(agents, ['a'], '').map((agent) => agent.id),
    ['b', 'c'],
  )
})

test('truncates generated group names to the persisted limit', () => {
  const name = namedConversationGroup('Mehdi', [
    { name: 'A'.repeat(60) },
    { name: 'B'.repeat(60) },
  ])
  assert.equal(name.length, MAX_GROUP_NAME_LENGTH)
  assert.equal(name, `Mehdi, ${'A'.repeat(60)}, ${'B'.repeat(11)}`)
})

test('includes the user first name in chat names', () => {
  assert.equal(namedConversationGroup('Mehdi', agents.slice(0, 2)), 'Mehdi, Alice, Bob')
})
