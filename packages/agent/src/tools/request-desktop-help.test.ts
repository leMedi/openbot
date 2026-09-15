import assert from 'node:assert/strict'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import type { ConversationMessage, SendMessagePayload, WaitingState } from '@openbot/db'
import type { ToolTurnContext } from './send-message'

const testData = path.resolve(process.cwd(), '../../.data', `desktop-help-${process.pid}`)
await rm(testData, { recursive: true, force: true })
process.env.OPENBOT_DATA_DIR = testData

const db = await import('@openbot/db')
const tool = await import('./request-desktop-help')
const tools = await import('./index')

test('exposes desktop handoff only to parent turns', () => {
  assert.equal(tools.agentToolDefinitions.some(
    (definition) => definition.function.name === 'RequestDesktopHelp'), true)
  assert.equal(tools.backgroundToolDefinitions.some(
    (definition) => definition.function.name === 'RequestDesktopHelp'), false)
  assert.equal(tools.browserUseWorkerToolDefinitions.some(
    (definition) => definition.function.name === 'RequestDesktopHelp'), false)
  assert.equal(tools.computerUseWorkerToolDefinitions.some(
    (definition) => definition.function.name === 'RequestDesktopHelp'), false)
})

test('durably suspends one desktop handoff with approved metadata', async () => {
  const created = await db.createAgent({ name: `Desktop help ${crypto.randomUUID()}` })
  const accepted = await db.acceptUserMessage({
    conversationId: created.conversation.id,
    text: 'Continue after I sign in',
    requestId: crypto.randomUUID(),
    idempotencyKey: crypto.randomUUID(),
  })
  await db.claimQueuedTurn(accepted.turn.id)
  let delivered: unknown
  const context: ToolTurnContext = {
    turnId: accepted.turn.id,
    conversationId: created.conversation.id,
    senderAgentId: null,
    priorDeliveries: [],
    onDelivered: (_message: ConversationMessage) => {},
    suspend: async (
      state: WaitingState,
      delivery: { bodyText: string; payload: SendMessagePayload },
    ) => {
      delivered = delivery
      const waiting = await db.deliverWidgetAndMarkTurnWaiting(accepted.turn.id, state, {
        ...delivery,
        senderAgentId: null,
      })
      return waiting?.message
    },
    enqueueBackgroundWake: async () => {},
    sendDirectAgentMessage: async () => { throw new Error('not used') },
    desktop: {} as never,
  }
  const result = await tool.executeRequestDesktopHelp(
    { ...created.agent, xDisplayNumber: 7 },
    {
      instruction: 'Sign in to Avito.ma, then hand the desktop back.',
      reason: 'auth',
      domain: 'avito.ma',
    },
    {
      id: 'call_handoff',
      type: 'function',
      function: { name: 'RequestDesktopHelp', arguments: '{}' },
    },
    context,
  )
  assert.equal(result.status, 'started')
  assert.match(result.handoff_id, /^handoff_/)
  assert.equal((delivered as { payload: { widget: { interactionKind: string } } }).payload.widget.interactionKind, 'handoff')
  const pending = await db.findPendingDesktopHandoff(created.agent.id)
  assert.equal(pending?.id, accepted.turn.id)
  assert.deepEqual(pending?.waitingStateJson?.options.map((option) => option.id), [
    'hand_back',
    'skip',
  ])
  assert.equal(
    (pending?.waitingStateJson?.resumeData as { agentId?: string }).agentId,
    created.agent.id,
  )
})

test('atomically allows only one pending handoff per agent', async () => {
  const created = await db.createAgent({ name: `Exclusive handoff ${crypto.randomUUID()}` })
  const now = Date.now()
  const turnIds = [db.createId('trn'), db.createId('trn')]
  await db.db.insert(db.turns).values(turnIds.map((id) => ({
    id,
    conversationId: created.conversation.id,
    targetAgentId: created.agent.id,
    lane: 'background',
    source: 'test',
    status: 'running',
    startedAt: now,
    createdAt: now,
    updatedAt: now,
  })))
  const context = (turnId: string): ToolTurnContext => ({
    turnId,
    conversationId: created.conversation.id,
    senderAgentId: created.agent.id,
    priorDeliveries: [],
    onDelivered: () => {},
    suspend: async (state, delivery) => {
      const waiting = await db.deliverWidgetAndMarkTurnWaiting(turnId, state, {
        ...delivery,
        senderAgentId: created.agent.id,
      })
      return waiting?.message
    },
    enqueueBackgroundWake: async () => {},
    sendDirectAgentMessage: async () => { throw new Error('not used') },
    desktop: {} as never,
  })
  const results = await Promise.all(turnIds.map((turnId, index) =>
    tool.executeRequestDesktopHelp(
      { ...created.agent, xDisplayNumber: 8 },
      { instruction: 'Complete the human-only step.', reason: 'other' },
      {
        id: `call_${index}`,
        type: 'function',
        function: { name: 'RequestDesktopHelp', arguments: '{}' },
      },
      context(turnId),
    )))
  assert.equal(results.filter((result) => result.status === 'started').length, 1)
  assert.equal(results.filter((result) => result.status !== 'started').length, 1)
  const turns = await Promise.all(turnIds.map((turnId) => db.getTurn(turnId)))
  assert.equal(turns.filter((turn) => turn?.status === 'waiting').length, 1)
  assert.equal(turns.filter((turn) => turn?.status === 'running').length, 1)
  const stillRunning = turns.find((turn) => turn?.status === 'running')!
  const rejected = await db.deliverWidgetAndMarkTurnWaiting(stillRunning.id, {
    version: 1,
    interactionKind: 'handoff',
    prompt: 'A duplicate handoff',
    options: [{ id: 'hand_back', label: 'Hand back' }],
    allowCustom: false,
    dismissOnMoveOn: false,
    originatingToolCall: { id: 'duplicate_call', name: 'RequestDesktopHelp' },
    resumeData: { version: 1, handoffId: 'duplicate_handoff' },
    response: null,
  }, {
    bodyText: 'A duplicate handoff',
    payload: { version: 1, event: 'test-handoff' },
    senderAgentId: created.agent.id,
  })
  assert.equal(rejected, undefined)
})
