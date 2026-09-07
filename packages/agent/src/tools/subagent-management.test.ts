import assert from 'node:assert/strict'
import test from 'node:test'
import type { ModelToolCall } from '@openbot/db'
import {
  executeCheckSubagent,
  executeMessageSubagent,
  executeStopSubagent,
} from './subagent-management'

const worker = {
  id: 'trn_worker', type: 'general-subagent', title: 'Inspect', status: 'running',
  startedAt: 100, elapsedMs: 50, attemptCount: 1,
}
const calls: unknown[] = []
const context = {
  async listSubagents() { return [worker] },
  async messageSubagent(input: unknown) { calls.push(input); return { status: 'steered' } },
  async stopSubagent(id: string) { calls.push(id); return { status: 'stopping' } },
} as never

test('CheckSubagent lists and selects workers', async () => {
  assert.deepEqual(await executeCheckSubagent({}, context), { subagents: [worker] })
  assert.deepEqual(await executeCheckSubagent({ subagent_id: worker.id }, context), worker)
})

test('MessageSubagent and StopSubagent use durable worker IDs', async () => {
  const call = { id: 'call_steer' } as ModelToolCall
  assert.deepEqual(
    await executeMessageSubagent({ subagent_id: worker.id, message: 'Wrap up.' }, call, context),
    { status: 'steered' },
  )
  assert.deepEqual(await executeStopSubagent({ subagent_id: worker.id }, context), { status: 'stopping' })
  assert.deepEqual(calls, [
    { subagentId: worker.id, message: 'Wrap up.', toolCallId: 'call_steer' },
    worker.id,
  ])
})
