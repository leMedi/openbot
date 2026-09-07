import assert from 'node:assert/strict'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'

const testData = path.resolve(process.cwd(), '../../.data', `routine-tests-${process.pid}`)
await rm(testData, { recursive: true, force: true })
process.env.OPENBOT_DATA_DIR = testData

const store = await import('./index')

test('queues a due routine once with a durable definition snapshot', async () => {
  const { agent, conversation } = await store.createAgent({ name: 'Scheduler' })
  const routine = await store.createRoutine({
    agentId: agent.id,
    conversationId: conversation.id,
    name: 'Morning brief',
    instruction: 'Summarize today.',
    cronExpression: '0 9 * * *',
    timezone: 'UTC',
  })
  const dueAt = Date.UTC(2026, 8, 7, 9, 0)
  await store.db.update(store.routines)
    .set({ nextRunAt: dueAt })
    .where((await import('drizzle-orm')).eq(store.routines.id, routine.id))

  const [turn] = await store.enqueueDueRoutineRuns(dueAt)
  assert.ok(turn)
  assert.equal(turn.routineId, routine.id)
  assert.equal(turn.source, 'routine')
  const wake = store.routineWakeSchema.parse(turn.runtimeContextJson.wake)
  assert.equal(wake.instruction, 'Summarize today.')
  assert.equal(wake.enabled, true)
  assert.equal(wake.nextRunAt, dueAt)
  assert.equal(wake.scheduledFor, dueAt)
  assert.deepEqual(await store.enqueueDueRoutineRuns(dueAt), [])
})

test('keeps an overdue slot pending while a routine run is unsettled', async () => {
  const { agent, conversation } = await store.createAgent({ name: 'Coalescer' })
  const routine = await store.createRoutine({
    agentId: agent.id,
    conversationId: conversation.id,
    name: 'Pulse',
    instruction: 'Check the pulse.',
    cronExpression: '*/15 * * * *',
    timezone: 'UTC',
  })
  const firstDue = Date.UTC(2026, 8, 7, 9, 0)
  const eq = (await import('drizzle-orm')).eq
  await store.db.update(store.routines).set({ nextRunAt: firstDue })
    .where(eq(store.routines.id, routine.id))
  const [first] = await store.enqueueDueRoutineRuns(firstDue)
  assert.ok(first)
  const secondDue = firstDue + 15 * 60_000
  assert.deepEqual(await store.enqueueDueRoutineRuns(secondDue), [])
  assert.equal((await store.getRoutine(routine.id))?.nextRunAt, secondDue)
  await store.finalizeTurnTerminal({
    turnId: first.id,
    status: 'cancelled',
    message: 'test settled',
  })
  const [coalesced] = await store.enqueueDueRoutineRuns(secondDue + 60_000)
  assert.ok(coalesced)
  assert.equal(store.routineWakeSchema.parse(coalesced.runtimeContextJson.wake).scheduledFor, secondDue)
})

test('rebinds routines when their delivery conversation is cleared', async () => {
  const { agent, conversation } = await store.createAgent({ name: 'Rebinder' })
  const routine = await store.createRoutine({
    agentId: agent.id,
    conversationId: conversation.id,
    name: 'Keep me',
    instruction: 'Stay attached.',
    cronExpression: '0 12 * * *',
    timezone: 'UTC',
  })
  const fresh = await store.clearConversation(conversation.id)
  assert.equal((await store.getRoutine(routine.id))?.conversationId, fresh.id)
})

test('preserves unique group and direct-inbox identity while clearing', async () => {
  const sender = await store.createAgent({ name: 'Sender' })
  const recipient = await store.createAgent({ name: 'Recipient' })
  const direct = await store.acceptDirectAgentMessage({
    senderAgentId: sender.agent.id,
    recipientAgentId: recipient.agent.id,
    content: 'hello',
  })
  const directRoutine = await store.createRoutine({
    agentId: recipient.agent.id,
    conversationId: direct.turn.conversationId,
    name: 'Inbox routine',
    instruction: 'Check the inbox.',
    cronExpression: '0 10 * * *',
    timezone: 'UTC',
  })
  const freshDirect = await store.clearConversation(direct.turn.conversationId)
  assert.equal(freshDirect.origin, 'agent-direct')
  assert.equal((await store.getRoutine(directRoutine.id))?.conversationId, freshDirect.id)

  const group = await store.createGroup({
    name: 'Clearable room',
    members: [{ type: 'agent', agentId: sender.agent.id }],
  })
  const freshGroup = await store.clearConversation(group.conversation.id)
  assert.equal(freshGroup.ownerGroupId, group.group.id)
})

test('rebinds a routine before deleting its delivery conversation', async () => {
  const { agent, conversation: fallback } = await store.createAgent({ name: 'Delete rebinder' })
  const doomed = await store.createConversation({
    ownerAgentId: agent.id,
    title: 'Temporary delivery',
  })
  const routine = await store.createRoutine({
    agentId: agent.id,
    conversationId: doomed.id,
    name: 'Survivor',
    instruction: 'Keep running.',
    cronExpression: '0 11 * * *',
    timezone: 'UTC',
  })
  assert.equal(await store.deleteConversation(doomed.id), true)
  assert.equal((await store.getRoutine(routine.id))?.conversationId, fallback.id)
})

test('rejects an approved resume after a concurrent definition edit', async () => {
  const { agent, conversation } = await store.createAgent({ name: 'Approval race' })
  const routine = await store.createRoutine({
    agentId: agent.id,
    conversationId: conversation.id,
    name: 'Paused work',
    instruction: 'Do the work.',
    cronExpression: '0 8 * * *',
    timezone: 'UTC',
    enabled: false,
  })
  await store.updateRoutine(routine.id, { name: 'Changed while waiting' })
  await assert.rejects(
    store.applyRoutineOperation(agent.id, conversation.id, {
      action: 'resume',
      routineId: routine.id,
      expectedRevision: routine.revision,
    }),
    /changed after approval/,
  )
})
