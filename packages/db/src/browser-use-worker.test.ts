import assert from 'node:assert/strict'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'

const testData = path.resolve(
  process.cwd(),
  '../../.data',
  `browser-use-worker-db-tests-${process.pid}`,
)
await rm(testData, { recursive: true, force: true })
process.env.OPENBOT_DATA_DIR = testData

const {
  acceptUserMessage,
  browserUseCompletionWakeSchema,
  browserUseWorkerContextSchema,
  claimQueuedTurn,
  completeTurn,
  createAgent,
  enqueueBrowserUseWorkerTurn,
  enqueueComputerUseWorkerTurn,
  finalizeBrowserUseWorkerTurn,
  finalizeTurnTerminal,
  getTurn,
} = await import('./index')

async function runningParent() {
  const created = await createAgent({ name: `Browser worker test ${crypto.randomUUID()}` })
  const accepted = await acceptUserMessage({
    conversationId: created.conversation.id,
    text: 'Use the browser',
    requestId: crypto.randomUUID(),
    idempotencyKey: crypto.randomUUID(),
  })
  const parent = await claimQueuedTurn(accepted.turn.id)
  assert.ok(parent)
  return { ...created, parent }
}

test('queues an idempotent browser worker under a running agent parent', async () => {
  const context = await runningParent()
  const input = {
    parentTurnId: context.parent.id,
    parentToolCallId: 'call_1',
    task: 'Open the account page and verify the current plan.',
    title: 'Verify account plan',
  }
  const worker = await enqueueBrowserUseWorkerTurn(input)
  const duplicate = await enqueueBrowserUseWorkerTurn(input)

  assert.equal(duplicate.id, worker.id)
  assert.equal(worker.conversationId, context.parent.conversationId)
  assert.equal(worker.targetAgentId, context.parent.targetAgentId)
  assert.equal(worker.parentTurnId, context.parent.id)
  assert.equal(worker.lane, 'agent')
  assert.equal(worker.source, 'subagent')
  assert.equal(worker.mode, 'browser-use')
  assert.equal(
    worker.idempotencyKey,
    `browser-use:${context.parent.id}:${input.parentToolCallId}`,
  )
  assert.deepEqual(browserUseWorkerContextSchema.parse(worker.runtimeContextJson), {
    version: 1,
    type: 'browser-use-worker',
    task: input.task,
    title: input.title,
    parentToolCallId: input.parentToolCallId,
  })
  await assert.rejects(
    enqueueBrowserUseWorkerTurn({ ...input, task: 'Open a different page.' }),
    /cannot be retried with different input/,
  )
})

test('allows computer-use but only one unsettled browser-use worker per agent', async () => {
  const context = await runningParent()
  const browserWorker = await enqueueBrowserUseWorkerTurn({
    parentTurnId: context.parent.id,
    parentToolCallId: 'call_browser',
    task: 'Check the account page.',
    title: 'Check account',
  })
  const computerWorker = await enqueueComputerUseWorkerTurn({
    parentTurnId: context.parent.id,
    parentToolCallId: 'call_computer',
    task: 'Open Settings.',
    title: 'Open Settings',
  })

  assert.equal(browserWorker.mode, 'browser-use')
  assert.equal(computerWorker.mode, 'computer-use')
  await assert.rejects(
    enqueueBrowserUseWorkerTurn({
      parentTurnId: context.parent.id,
      parentToolCallId: 'call_other_browser',
      task: 'Check another page.',
      title: 'Check another page',
    }),
    /already using this agent browser/,
  )
})

test('concurrent browser worker launches permit only one winner', async () => {
  const context = await runningParent()
  const results = await Promise.allSettled([
    enqueueBrowserUseWorkerTurn({
      parentTurnId: context.parent.id,
      parentToolCallId: 'call_concurrent_1',
      task: 'Check the first page.',
      title: 'Check first page',
    }),
    enqueueBrowserUseWorkerTurn({
      parentTurnId: context.parent.id,
      parentToolCallId: 'call_concurrent_2',
      task: 'Check the second page.',
      title: 'Check second page',
    }),
  ])

  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1)
  assert.equal(results.filter((result) => result.status === 'rejected').length, 1)
  const rejected = results.find((result) => result.status === 'rejected')
  assert.match(String(rejected?.reason), /already using this agent browser/)
})

test('rejects a browser worker launched by a non-running parent', async () => {
  const context = await runningParent()
  await completeTurn(context.parent.id, { status: 'succeeded' })

  await assert.rejects(
    enqueueBrowserUseWorkerTurn({
      parentTurnId: context.parent.id,
      parentToolCallId: 'call_settled_parent',
      task: 'Check the account page.',
      title: 'Check account',
    }),
    /can only be launched by a running agent turn/,
  )
})

test('never claims a worker beneath a cancelled ancestor', async () => {
  const context = await runningParent()
  const worker = await enqueueBrowserUseWorkerTurn({
    parentTurnId: context.parent.id,
    parentToolCallId: 'call_cancelled_ancestor',
    task: 'Do not run after cancellation.',
    title: 'Cancelled work',
  })
  await finalizeTurnTerminal({
    turnId: context.parent.id,
    status: 'cancelled',
    message: 'Cancelled by user',
  })

  assert.equal(await claimQueuedTurn(worker.id), undefined)
})

test('atomically settles a browser worker and queues one completion wake', async () => {
  const context = await runningParent()
  const worker = await enqueueBrowserUseWorkerTurn({
    parentTurnId: context.parent.id,
    parentToolCallId: 'call_complete',
    task: 'Verify the current plan.',
    title: 'Verify account plan',
  })
  await completeTurn(context.parent.id, { status: 'succeeded' })
  assert.ok(await claimQueuedTurn(worker.id))

  const completion = await finalizeBrowserUseWorkerTurn({
    turnId: worker.id,
    status: 'succeeded',
    summary: 'The account is on the Pro plan.',
  })
  assert.equal(completion.changed, true)
  assert.equal(completion.turn.status, 'succeeded')
  assert.ok(completion.wakeTurn)
  assert.equal(completion.wakeTurn.parentTurnId, worker.id)
  assert.equal(completion.wakeTurn.lane, 'background')
  assert.equal(completion.wakeTurn.source, 'browser-use-completion')
  assert.equal(completion.wakeTurn.idempotencyKey, `browser-use-completion:${worker.id}`)
  assert.deepEqual(
    browserUseCompletionWakeSchema.parse(completion.wakeTurn.runtimeContextJson.wake),
    {
      version: 1,
      type: 'browser-use-completed',
      childTurnId: worker.id,
      parentTurnId: context.parent.id,
      title: 'Verify account plan',
      status: 'succeeded',
      summary: 'The account is on the Pro plan.',
    },
  )

  const duplicate = await finalizeBrowserUseWorkerTurn({
    turnId: worker.id,
    status: 'succeeded',
    summary: 'The account is on the Pro plan.',
  })
  assert.equal(duplicate.changed, false)
  assert.equal(duplicate.wakeTurn?.id, completion.wakeTurn.id)
  assert.equal((await getTurn(worker.id))?.status, 'succeeded')
})

test('reports browser worker failure through its completion wake', async () => {
  const context = await runningParent()
  const worker = await enqueueBrowserUseWorkerTurn({
    parentTurnId: context.parent.id,
    parentToolCallId: 'call_failure',
    task: 'Verify the current plan.',
    title: 'Verify account plan',
  })
  await completeTurn(context.parent.id, { status: 'succeeded' })
  assert.ok(await claimQueuedTurn(worker.id))

  const completion = await finalizeBrowserUseWorkerTurn({
    turnId: worker.id,
    status: 'failed',
    summary: 'The account page did not load.',
  })

  assert.equal(completion.turn.status, 'failed')
  assert.equal(completion.turn.errorJson?.message, 'The account page did not load.')
  assert.equal(
    browserUseCompletionWakeSchema.parse(completion.wakeTurn?.runtimeContextJson.wake)
      .status,
    'failed',
  )
})
