import assert from 'node:assert/strict'
import test from 'node:test'
import {
  parseGroupMentions,
  parseOrchestratorAgentIds,
  isGroupPass,
  orderRoundSpeakers,
  resolveResponders,
  type GroupRoutingMessage,
} from '../orchestration'

test('parses and constrains group orchestrator selections', () => {
  const allowed = new Set(['agt_one', 'agt_two'])
  assert.deepEqual(
    parseOrchestratorAgentIds(
      '```json\n{"agentIds":["agt_two","unknown","agt_two"]}\n```',
      allowed,
    ),
    ['agt_two'],
  )
  assert.equal(parseOrchestratorAgentIds('not json', allowed), undefined)
})

const members = [
  { id: 'agt_alice', name: 'Alice Smith' },
  { id: 'agt_bob', name: 'Bob Jones' },
  { id: 'agt_ann', name: 'Ann' },
]

test('parses explicit member and everyone mentions', () => {
  assert.deepEqual(parseGroupMentions('@alice and @BobJones', members), {
    isEveryone: false,
    memberIds: ['agt_alice', 'agt_bob'],
  })
  assert.deepEqual(parseGroupMentions('Please ask @Alice Smith and @all.', members), {
    isEveryone: true,
    memberIds: ['agt_alice'],
  })
})

test('requires @ and respects mention boundaries', () => {
  assert.deepEqual(parseGroupMentions('Alice should answer', members).memberIds, [])
  assert.deepEqual(parseGroupMentions('email@alice.com and @announcement', members).memberIds, [])
  assert.deepEqual(parseGroupMentions('Ask @ann.', members).memberIds, ['agt_ann'])
})

test('resolves mentioned responders in membership order', () => {
  const history: GroupRoutingMessage[] = [
    { speaker: { kind: 'user' }, content: 'Earlier message for @Alice' },
    { speaker: { kind: 'member', id: 'agt_alice' }, content: 'Earlier reply' },
    { speaker: { kind: 'user' }, content: '@Bob and @Ann, please answer' },
  ]
  assert.deepEqual(resolveResponders(members, history), [members[1], members[2]])
})

test('resolves all responders without mentions or with an everyone mention', () => {
  assert.deepEqual(resolveResponders(members, [
    { speaker: { kind: 'user' }, content: 'Who can help?' },
  ]), members)
  assert.deepEqual(resolveResponders(members, [
    { speaker: { kind: 'user' }, content: '@everyone please answer' },
  ]), members)
})

test('includes mentions made after the latest user message', () => {
  const history: GroupRoutingMessage[] = [
    { speaker: { kind: 'user' }, content: 'Please discuss this' },
    { speaker: { kind: 'member', id: 'agt_alice' }, content: '@Bob, what do you think?' },
  ]
  assert.deepEqual(resolveResponders(members, history), [members[1]])
})

test('recognizes pass messages and rotates round order', () => {
  assert.equal(isGroupPass('(pass)'), true)
  assert.equal(isGroupPass('Pass.'), true)
  assert.equal(isGroupPass('I pass this result along'), false)
  assert.deepEqual(orderRoundSpeakers(['a', 'b', 'c'], 1), ['b', 'c', 'a'])
  assert.deepEqual(orderRoundSpeakers(['a', 'b', 'c'], 2), ['c', 'a', 'b'])
})
