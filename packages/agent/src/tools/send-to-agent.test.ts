import assert from 'node:assert/strict'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'

const testData = path.resolve(process.cwd(), '../../.data', `send-to-agent-tests-${process.pid}`)
await rm(testData, { recursive: true, force: true })
process.env.OPENBOT_DATA_DIR = testData

const {
  SEND_TO_AGENT_TOOL_NAME,
  sendToAgentArgsSchema,
  sendToAgentToolDefinition,
} = await import('./send-to-agent')

test('uses the Grok-compatible SendToAgent contract', () => {
  assert.equal(SEND_TO_AGENT_TOOL_NAME, 'SendToAgent')
  assert.equal(sendToAgentToolDefinition.function.name, 'SendToAgent')
  assert.deepEqual(sendToAgentArgsSchema.parse({
    target_id: 'agt_peer',
    message: 'Please check this.',
    images: [{ url: 'file:///workspace/chart.png', alt: 'Chart' }],
    priority: true,
  }), {
    target_id: 'agt_peer',
    message: 'Please check this.',
    images: [{ url: 'file:///workspace/chart.png', alt: 'Chart' }],
    priority: true,
  })
  assert.throws(
    () => sendToAgentArgsSchema.parse({ target_id: 'agt_peer', message: 'x'.repeat(8_001) }),
  )
  assert.throws(
    () => sendToAgentArgsSchema.parse({
      target_id: 'agt_peer',
      message: 'Look',
      images: [{ url: '/workspace/chart.png' }],
    }),
  )
})
