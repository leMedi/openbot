import assert from 'node:assert/strict'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import type { TurnStreamEvent } from './turn-runner'

const testData = path.resolve(process.cwd(), '../../.data', `browser-worker-queue-${process.pid}`)
await rm(testData, { recursive: true, force: true })
process.env.OPENBOT_DATA_DIR = testData

const db = await import('@openbot/db')
const { cancelTurnExecution, watchTurn } = await import('./turn-runner')

async function runningParent() {
  const created = await db.createAgent({ name: `Browser queue ${crypto.randomUUID()}` })
  const accepted = await db.acceptUserMessage({
    conversationId: created.conversation.id,
    text: 'Use the browser',
    requestId: crypto.randomUUID(),
    idempotencyKey: crypto.randomUUID(),
  })
  const parent = await db.claimQueuedTurn(accepted.turn.id)
  assert.ok(parent)
  return { ...created, parent }
}

test('cancels a queued browser worker with its parent', async () => {
  const context = await runningParent()
  const worker = await db.enqueueBrowserUseWorkerTurn({
    parentTurnId: context.parent.id,
    parentToolCallId: 'call_browser_cancel',
    task: 'Open a page.',
    title: 'Open a page',
  })
  await cancelTurnExecution(context.parent.id)
  assert.equal((await db.getTurn(worker.id))?.status, 'cancelled')
})

test('a persisted stream follows browser delegation and its untrusted completion wake', async () => {
  const context = await runningParent()
  const worker = await db.enqueueBrowserUseWorkerTurn({
    parentTurnId: context.parent.id,
    parentToolCallId: 'call_browser_stream',
    task: 'Open a page.',
    title: 'Open a page',
  })
  await db.completeTurn(context.parent.id, { status: 'succeeded' })
  assert.ok(await db.claimQueuedTurn(worker.id))
  const completion = await db.finalizeBrowserUseWorkerTurn({
    turnId: worker.id,
    status: 'succeeded',
    summary: 'The page opened.',
  })
  assert.ok(completion.wakeTurn)
  assert.ok(await db.claimQueuedTurn(completion.wakeTurn.id))
  const delivered = await db.appendConversationMessage({
    conversationId: context.conversation.id,
    turnId: completion.wakeTurn.id,
    kind: 'message',
    role: 'assistant',
    direction: 'outbound',
    bodyText: 'The page is open.',
    payload: {
      version: 1,
      deliveryKind: 'send-message',
      type: 'text',
      toolCallId: 'call_browser_report',
    },
    senderAgentId: null,
  })
  await db.completeTurn(completion.wakeTurn.id, { status: 'succeeded' })
  const events: TurnStreamEvent[] = []
  await watchTurn(context.parent.id, (event) => events.push(event))
  assert.deepEqual(events, [
    { type: 'message', message: delivered },
    { type: 'done', turnId: completion.wakeTurn.id },
  ])
})
