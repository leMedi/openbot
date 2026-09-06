import assert from 'node:assert/strict'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'

const testData = path.resolve(process.cwd(), '../../.data', `app-agent-server-tests-${process.pid}`)
await rm(testData, { recursive: true, force: true })
process.env.OPENBOT_DATA_DIR = testData

const { agentDeleteInputSchema } = await import('./agents')

test('agent deletion accepts only a strict generated agent id input', () => {
  const valid = { id: `agt_${'A0_-'.repeat(5)}A0` }
  assert.deepEqual(agentDeleteInputSchema.parse(valid), valid)
  assert.throws(() => agentDeleteInputSchema.parse({ id: 'agt_short' }))
  assert.throws(() => agentDeleteInputSchema.parse({ ...valid, unexpected: true }))
})
