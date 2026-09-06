import assert from 'node:assert/strict'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import type { TurnStreamEvent } from './turn-runner'

const testData = path.resolve(
  process.cwd(),
  '../../.data',
  `computer-use-worker-queue-tests-${process.pid}`,
)
await rm(testData, { recursive: true, force: true })
process.env.OPENBOT_DATA_DIR = testData

const {
  acceptUserMessage,
  appendConversationMessage,
  claimQueuedTurn,
  completeTurn,
  computerUseCompletionWakeSchema,
  computerUseWorkerContextSchema,
  createAgent,
  enqueueComputerUseWorkerTurn,
  finalizeComputerUseWorkerTurn,
  findNextQueuedTurnForAgent,
  getTurn,
} = await import('@openbot/db')
const { cancelTurnExecution, watchTurn } = await import('./turn-runner')

async function runningParent() {
  const created = await createAgent({ name: `Worker test ${crypto.randomUUID()}` })
  const accepted = await acceptUserMessage({
    conversationId: created.conversation.id,
    text: 'Use the desktop',
    requestId: crypto.randomUUID(),
    idempotencyKey: crypto.randomUUID(),
  })
  const parent = await claimQueuedTurn(accepted.turn.id)
  assert.ok(parent)
  return { ...created, parent }
}

test('queues one idempotent isolated worker under a running parent', async () => {
  const context = await runningParent()
  const input = {
    parentTurnId: context.parent.id,
    parentToolCallId: 'call_1',
    task: 'Open Settings and verify Wi-Fi is enabled.',
    title: 'Verify Wi-Fi',
  }
  const worker = await enqueueComputerUseWorkerTurn(input)
  const duplicate = await enqueueComputerUseWorkerTurn(input)

  assert.equal(duplicate.id, worker.id)
  assert.equal(worker.parentTurnId, context.parent.id)
  assert.equal(worker.source, 'subagent')
  assert.equal(worker.mode, 'computer-use')
  assert.deepEqual(computerUseWorkerContextSchema.parse(worker.runtimeContextJson), {
    version: 1,
    type: 'computer-use-worker',
    task: input.task,
    title: input.title,
    parentToolCallId: input.parentToolCallId,
  })
  await assert.rejects(
    enqueueComputerUseWorkerTurn({ ...input, parentToolCallId: 'call_2' }),
    /already using this agent desktop/,
  )
})

test('claims the worker after its parent and atomically queues one completion wake', async () => {
  const context = await runningParent()
  const worker = await enqueueComputerUseWorkerTurn({
    parentTurnId: context.parent.id,
    parentToolCallId: 'call_complete',
    task: 'Open Settings and verify Wi-Fi is enabled.',
    title: 'Verify Wi-Fi',
  })

  assert.equal(await findNextQueuedTurnForAgent(context.agent.id), undefined)
  await completeTurn(context.parent.id, { status: 'succeeded' })
  const claimedWorker = await claimQueuedTurn(worker.id)
  assert.equal(claimedWorker?.id, worker.id)

  const completion = await finalizeComputerUseWorkerTurn({
    turnId: worker.id,
    status: 'succeeded',
    summary: 'Wi-Fi was visibly enabled in Settings.',
  })
  assert.equal(completion.changed, true)
  assert.equal(completion.turn.status, 'succeeded')
  assert.ok(completion.wakeTurn)
  assert.equal(completion.wakeTurn.parentTurnId, worker.id)
  assert.equal(completion.wakeTurn.source, 'computer-use-completion')
  assert.deepEqual(
    computerUseCompletionWakeSchema.parse(completion.wakeTurn.runtimeContextJson.wake),
    {
      version: 1,
      type: 'computer-use-completed',
      childTurnId: worker.id,
      parentTurnId: context.parent.id,
      title: 'Verify Wi-Fi',
      status: 'succeeded',
      summary: 'Wi-Fi was visibly enabled in Settings.',
    },
  )

  const duplicate = await finalizeComputerUseWorkerTurn({
    turnId: worker.id,
    status: 'succeeded',
    summary: 'Wi-Fi was visibly enabled in Settings.',
  })
  assert.equal(duplicate.changed, false)
  assert.equal(duplicate.wakeTurn?.id, completion.wakeTurn.id)
  assert.equal((await getTurn(worker.id))?.status, 'succeeded')
})

test('cancelling a parent also cancels its queued computer worker', async () => {
  const context = await runningParent()
  const worker = await enqueueComputerUseWorkerTurn({
    parentTurnId: context.parent.id,
    parentToolCallId: 'call_cancel',
    task: 'Open Settings.',
    title: 'Open Settings',
  })

  await cancelTurnExecution(context.parent.id)

  assert.equal((await getTurn(context.parent.id))?.status, 'cancelled')
  assert.equal((await getTurn(worker.id))?.status, 'cancelled')
})

test('worker failure is reported through a completion wake', async () => {
  const context = await runningParent()
  const worker = await enqueueComputerUseWorkerTurn({
    parentTurnId: context.parent.id,
    parentToolCallId: 'call_failure',
    task: 'Open Settings.',
    title: 'Open Settings',
  })
  await completeTurn(context.parent.id, { status: 'succeeded' })
  assert.ok(await claimQueuedTurn(worker.id))

  const completion = await finalizeComputerUseWorkerTurn({
    turnId: worker.id,
    status: 'failed',
    summary: 'Settings did not open.',
  })

  assert.equal(completion.turn.status, 'failed')
  assert.equal(completion.turn.errorJson?.message, 'Settings did not open.')
  assert.equal(
    computerUseCompletionWakeSchema.parse(completion.wakeTurn?.runtimeContextJson.wake)
      .status,
    'failed',
  )
})

test('a persisted stream follows the parent, worker, and completion wake', async () => {
  const context = await runningParent()
  const worker = await enqueueComputerUseWorkerTurn({
    parentTurnId: context.parent.id,
    parentToolCallId: 'call_stream',
    task: 'Open Settings.',
    title: 'Open Settings',
  })
  await completeTurn(context.parent.id, { status: 'succeeded' })
  assert.ok(await claimQueuedTurn(worker.id))
  const completion = await finalizeComputerUseWorkerTurn({
    turnId: worker.id,
    status: 'succeeded',
    summary: 'Settings opened.',
  })
  assert.ok(completion.wakeTurn)
  assert.ok(await claimQueuedTurn(completion.wakeTurn.id))
  const delivered = await appendConversationMessage({
    conversationId: context.conversation.id,
    turnId: completion.wakeTurn.id,
    kind: 'message',
    role: 'assistant',
    direction: 'outbound',
    bodyText: 'Settings is open.',
    payload: {
      version: 1,
      deliveryKind: 'send-message',
      type: 'text',
      toolCallId: 'call_report',
    },
    senderAgentId: null,
  })
  await completeTurn(completion.wakeTurn.id, { status: 'succeeded' })

  const events: TurnStreamEvent[] = []
  await watchTurn(context.parent.id, (event) => events.push(event))

  assert.deepEqual(events, [
    { type: 'message', message: delivered },
    { type: 'done', turnId: completion.wakeTurn.id },
  ])
})
