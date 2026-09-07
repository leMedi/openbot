import assert from 'node:assert/strict'
import test from 'node:test'
import { mentionItems } from './suggestions'

test('uses the live agent roster for @ mentions', () => {
  assert.deepEqual(
    mentionItems({ query: 'po2', agents: [{ id: 'agt_po2', name: 'PO2' }] }),
    [{ id: 'agt_po2', label: 'PO2', kind: 'member' }],
  )
})
