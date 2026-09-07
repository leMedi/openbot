import assert from 'node:assert/strict'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'

const testData = path.resolve(process.cwd(), '../../.data', `subagent-db-tests-${process.pid}`)
await rm(testData, { recursive: true, force: true })
process.env.OPENBOT_DATA_DIR = testData

const {
  acceptUserMessage,
  claimQueuedSubagentTurn,
  claimQueuedTurn,
  createAgent,
  completeTurn,
  deliverWidgetAndMarkTurnWaiting,
  enqueueGeneralSubagentTurn,
  finalizeGeneralSubagentTurn,
  findNextQueuedTurnForAgent,
  findUnsettledForegroundTurn,
  generalSubagentCompletionWakeSchema,
  generalSubagentContextSchema,
  listSubagentTurns,
  listConversationMessages,
  listPendingSubagentSteers,
  markSubagentSteersApplied,
  requestSubagentSteer,
  subagentControlPayloadSchema,
} = await import('./index')

async function runningParent() {
  const created = await createAgent({ name: `Subagent test ${crypto.randomUUID()}` })
  const accepted = await acceptUserMessage({
    conversationId: created.conversation.id,
    text: 'Delegate this work',
    requestId: crypto.randomUUID(),
    idempotencyKey: crypto.randomUUID(),
  })
  const parent = await claimQueuedTurn(accepted.turn.id)
  assert.ok(parent)
  return { ...created, parent }
}

test('general subagents claim concurrently with their running parent', async () => {
  const context = await runningParent()
  const worker = await enqueueGeneralSubagentTurn({
    parentTurnId: context.parent.id,
    parentToolCallId: 'call_task',
    task: 'Inspect the repository and identify the relevant module.',
    title: 'Inspect repository',
  })

  assert.equal(await findNextQueuedTurnForAgent(context.agent.id), undefined)
  const claimed = await claimQueuedSubagentTurn(worker.id)
  assert.equal(claimed?.status, 'running')
  assert.equal((await listSubagentTurns(context.agent.id, true)).length, 1)
  assert.deepEqual(generalSubagentContextSchema.parse(worker.runtimeContextJson), {
    version: 1,
    type: 'general-subagent',
    task: 'Inspect the repository and identify the relevant module.',
    title: 'Inspect repository',
    parentToolCallId: 'call_task',
  })
})

test('general subagent completion queues an idempotent parent wake', async () => {
  const context = await runningParent()
  const worker = await enqueueGeneralSubagentTurn({
    parentTurnId: context.parent.id,
    parentToolCallId: 'call_complete',
    task: 'Read the module and summarize it.',
    title: 'Summarize module',
  })
  assert.ok(await claimQueuedSubagentTurn(worker.id))

  const completion = await finalizeGeneralSubagentTurn({
    turnId: worker.id,
    status: 'succeeded',
    summary: 'The module owns durable queue claims.',
  })
  assert.ok(completion.wakeTurn)
  assert.deepEqual(
    generalSubagentCompletionWakeSchema.parse(completion.wakeTurn.runtimeContextJson.wake),
    {
      version: 1,
      type: 'general-subagent-completed',
      childTurnId: worker.id,
      parentTurnId: context.parent.id,
      title: 'Summarize module',
      status: 'succeeded',
      summary: 'The module owns durable queue claims.',
    },
  )

  const duplicate = await finalizeGeneralSubagentTurn({
    turnId: worker.id,
    status: 'succeeded',
    summary: 'The module owns durable queue claims.',
  })
  assert.equal(duplicate.changed, false)
  assert.equal(duplicate.wakeTurn?.id, completion.wakeTurn.id)
})

test('subagent steering is durable, idempotent, and scoped to the owning agent', async () => {
  const context = await runningParent()
  const worker = await enqueueGeneralSubagentTurn({
    parentTurnId: context.parent.id,
    parentToolCallId: 'call_worker',
    task: 'Inspect the repository.',
    title: 'Inspect repository',
  })
  assert.ok(await claimQueuedSubagentTurn(worker.id))

  const request = {
    agentId: context.agent.id,
    requestingTurnId: context.parent.id,
    subagentTurnId: worker.id,
    toolCallId: 'call_steer',
    message: 'Focus on the scheduler and wrap up.',
  }
  const first = await requestSubagentSteer(request)
  const duplicate = await requestSubagentSteer(request)
  assert.equal(first.status, 'requested')
  assert.equal(duplicate.status, 'requested')
  assert.equal(duplicate.control?.controlId, first.control?.controlId)

  const pending = await listPendingSubagentSteers(worker.id)
  assert.equal(pending.length, 1)
  assert.equal(pending[0]?.message, request.message)
  await markSubagentSteersApplied(pending)
  assert.deepEqual(await listPendingSubagentSteers(worker.id), [])

  assert.equal((await requestSubagentSteer({ ...request, agentId: 'agt_other' })).status, 'not-found')

  const concurrentRequest = {
    ...request,
    toolCallId: 'call_concurrent_steer',
    message: 'Use the queue implementation as the source of truth.',
  }
  const concurrent = await Promise.all(
    Array.from({ length: 4 }, () => requestSubagentSteer(concurrentRequest)),
  )
  assert.equal(new Set(concurrent.map((result) => result.control?.controlId)).size, 1)
  const concurrentControlId = concurrent[0]?.control?.controlId
  const persistedRequests = (await listConversationMessages(context.conversation.id)).filter((row) => {
    const parsed = subagentControlPayloadSchema.safeParse(row.payloadJson)
    return parsed.success &&
      parsed.data.controlId === concurrentControlId &&
      parsed.data.stage === 'requested'
  })
  assert.equal(persistedRequests.length, 1)
  await assert.rejects(() => requestSubagentSteer({
    ...concurrentRequest,
    message: 'Different guidance with the same idempotency token.',
  }))
})

test('a new foreground turn runs while a subagent remains active', async () => {
  const context = await runningParent()
  const worker = await enqueueGeneralSubagentTurn({
    parentTurnId: context.parent.id,
    parentToolCallId: 'call_parallel',
    task: 'Continue the background analysis.',
    title: 'Background analysis',
  })
  assert.ok(await claimQueuedSubagentTurn(worker.id))
  await completeTurn(context.parent.id, { status: 'succeeded' })

  const next = await acceptUserMessage({
    conversationId: context.conversation.id,
    text: 'How is the worker doing?',
    requestId: crypto.randomUUID(),
    idempotencyKey: crypto.randomUUID(),
  })
  assert.equal((await findUnsettledForegroundTurn(context.conversation.id))?.id, next.turn.id)
  assert.equal((await findNextQueuedTurnForAgent(context.agent.id))?.id, next.turn.id)
  assert.equal((await claimQueuedTurn(next.turn.id))?.id, next.turn.id)
})

test('a queued subagent does not block the foreground queue candidate', async () => {
  const context = await runningParent()
  const worker = await enqueueGeneralSubagentTurn({
    parentTurnId: context.parent.id,
    parentToolCallId: 'call_queued_parallel',
    task: 'Wait in the background queue.',
    title: 'Queued background work',
  })
  await completeTurn(context.parent.id, { status: 'succeeded' })

  const next = await acceptUserMessage({
    conversationId: context.conversation.id,
    text: 'Start this foreground turn.',
    requestId: crypto.randomUUID(),
    idempotencyKey: crypto.randomUUID(),
  })
  assert.equal((await findNextQueuedTurnForAgent(context.agent.id))?.id, next.turn.id)
  assert.equal((await claimQueuedTurn(next.turn.id))?.id, next.turn.id)
  assert.equal((await claimQueuedSubagentTurn(worker.id))?.id, worker.id)
})

test('a new user message does not dismiss a waiting subagent', async () => {
  const context = await runningParent()
  const worker = await enqueueGeneralSubagentTurn({
    parentTurnId: context.parent.id,
    parentToolCallId: 'call_waiting_worker',
    task: 'Wait for a decision.',
    title: 'Waiting background work',
  })
  assert.ok(await claimQueuedSubagentTurn(worker.id))
  assert.ok(await deliverWidgetAndMarkTurnWaiting(worker.id, {
    version: 1,
    interactionKind: 'question',
    prompt: 'Choose how to continue.',
    options: [],
    allowCustom: true,
    dismissOnMoveOn: true,
    originatingToolCall: { id: 'call_question', name: 'SendMessage' },
    resumeData: null,
    response: null,
  }, {
    bodyText: 'Choose how to continue.',
    payload: { version: 1, type: 'widget' },
    senderAgentId: context.agent.id,
  }))
  await completeTurn(context.parent.id, { status: 'succeeded' })

  await acceptUserMessage({
    conversationId: context.conversation.id,
    text: 'Start unrelated foreground work.',
    requestId: crypto.randomUUID(),
    idempotencyKey: crypto.randomUUID(),
  })
  assert.equal((await listSubagentTurns(context.agent.id, true))[0]?.status, 'waiting')
})
