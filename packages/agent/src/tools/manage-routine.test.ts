import assert from 'node:assert/strict'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import type { ModelToolCall, WaitingState } from '@openbot/db'
import type { ToolTurnContext } from './send-message'

const testData = path.resolve(process.cwd(), '../../.data', `manage-routine-tests-${process.pid}`)
await rm(testData, { recursive: true, force: true })
process.env.OPENBOT_DATA_DIR = testData

const store = await import('@openbot/db')
const { executeManageRoutine, manageRoutineArgsSchema } = await import('./manage-routine')

test('requires durable approval before applying a model-created routine', async () => {
  const { agent, conversation } = await store.createAgent({ name: 'Routine manager' })
  let waiting: WaitingState | undefined
  const context = {
    turnId: 'trn-test',
    conversationId: conversation.id,
    senderAgentId: null,
    priorDeliveries: [],
    onDelivered: () => {},
    suspend: async (state: WaitingState) => {
      waiting = state
      return undefined
    },
    enqueueBackgroundWake: async () => {},
    sendDirectAgentMessage: async () => { throw new Error('not used') },
  } satisfies ToolTurnContext
  const call: ModelToolCall = {
    id: 'call-routine-create',
    type: 'function',
    function: { name: 'ManageRoutine', arguments: '{}' },
  }
  const args = manageRoutineArgsSchema.parse({
    action: 'create',
    name: 'Daily brief',
    instruction: 'Send a daily brief.',
    cron: '0 9 * * *',
    timezone: 'UTC',
  })

  const result = await executeManageRoutine(agent.id, args, call, context)
  assert.deepEqual(result.status, 'waiting_for_approval')
  assert.deepEqual(await store.listRoutines(agent.id), [])
  assert.match(waiting?.prompt ?? '', /schedule “0 9 \* \* \*”/)
  assert.match(waiting?.prompt ?? '', /instruction “Send a daily brief\.”/)
  assert.match(waiting?.prompt ?? '', /create an enabled routine/)
  const approval = store.routineApprovalResumeSchema.parse(waiting?.resumeData)
  const created = await store.applyRoutineOperation(
    agent.id,
    conversation.id,
    approval.operation,
  )
  assert.equal('name' in created && created.name, 'Daily brief')
  assert.equal((await store.listRoutines(agent.id)).length, 1)
})
