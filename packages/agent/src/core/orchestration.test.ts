import assert from 'node:assert/strict'
import test from 'node:test'
import { parseOrchestratorAgentIds } from '../orchestration'

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
