import { mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const dataDirectory = mkdtempSync(path.join(os.tmpdir(), 'openbot-turn-runner-test-'))
process.env.OPENBOT_DATA_DIR = dataDirectory

type DbModule = typeof import('@openbot/db')
type RunnerModule = typeof import('./turn-runner')
type ModelToolCall = import('@openbot/db').ModelToolCall
type ModelMessage = import('@openbot/db').ModelMessage

type ScriptedCompletion = { text: string; toolCalls: ModelToolCall[] }
type RecordedRequest = {
  messages: ModelMessage[]
  tools?: string[]
  toolChoice?: { type: string; function: { name: string } }
}

const { scripted, requests } = vi.hoisted(() => ({
  scripted: [] as ScriptedCompletion[],
  requests: [] as RecordedRequest[],
}))

vi.mock('./ai', () => ({
  getAiConfig: () => ({ baseUrl: 'http://mock', apiKey: 'key', model: 'mock-model' }),
  streamChatCompletion: async (
    _config: unknown,
    messages: ModelMessage[],
    _onDelta: unknown,
    _signal: unknown,
    tools?: { function: { name: string } }[],
    toolChoice?: { type: string; function: { name: string } },
  ) => {
    requests.push({
      messages: JSON.parse(JSON.stringify(messages)),
      tools: tools?.map((tool) => tool.function.name),
      toolChoice,
    })
    const next = scripted.shift()
    if (!next) throw new Error('No scripted completion left')
    return next
  },
}))

let db: DbModule
let runner: RunnerModule

beforeAll(async () => {
  ;[db, runner] = await Promise.all([import('@openbot/db'), import('./turn-runner')])
})

beforeEach(() => {
  scripted.length = 0
  requests.length = 0
})

let callSeq = 0
function toolCall(name: string, args: unknown): ModelToolCall {
  return {
    id: `call_${++callSeq}`,
    type: 'function',
    function: { name, arguments: JSON.stringify(args) },
  }
}

function sendText(content: string) {
  return toolCall('SendMessage', { type: 'text', content })
}

async function makeQueuedTurn(name: string, text = 'hello') {
  const { agent } = await db.createAgent({ name })
  const conversation = await db.createConversation({ ownerAgentId: agent.id })
  const { turn } = await db.acceptUserMessage({ conversationId: conversation.id, text })
  return { agent, conversation, turn }
}

async function drain(agentId: string) {
  await runner.ensureAgentDrain(agentId)
}

function deliveriesOf(rows: import('@openbot/db').ConversationMessage[], turnId: string) {
  return rows.filter(
    (row) => row.turnId === turnId && row.payloadJson.deliveryKind === 'send-message',
  )
}

describe('turn runner with SendMessage delivery', () => {
  it('persists deliveries in-flight, strips reminders from the checkpoint, and settles', async () => {
    const { agent, conversation, turn } = await makeQueuedTurn('Runner Happy')
    scripted.push(
      { text: 'private planning', toolCalls: [sendText('Working on it.')] },
      { text: 'private wrap-up', toolCalls: [] },
    )
    await drain(agent.id)

    expect((await db.getTurn(turn.id))?.status).toBe('succeeded')
    const rows = await db.listConversationMessages(conversation.id)
    const delivered = deliveriesOf(rows, turn.id)
    expect(delivered).toHaveLength(1)
    expect(delivered[0].bodyText).toBe('Working on it.')
    // Private prose never became a transcript row.
    expect(rows.some((row) => row.bodyText?.includes('private'))).toBe(false)

    // The first request carries the per-turn reply reminder…
    expect(
      requests[0].messages.some(
        (m) => m.role === 'user' && m.content.startsWith('<system_reminder>'),
      ),
    ).toBe(true)
    // …but the checkpoint keeps only real history, private prose included.
    const checkpoint = await db.getCurrentCheckpoint(conversation.id)
    const state = db.checkpointStateSchema.parse(checkpoint!.stateJson)
    expect(state.modelMessages.some((m) => m.content.startsWith('<system_reminder>'))).toBe(
      false,
    )
    expect(state.modelMessages.at(-1)).toMatchObject({ content: 'private wrap-up' })

    // A watcher of the finished turn replays the delivery then settles.
    const events: { type: string }[] = []
    await runner.watchTurn(turn.id, (event) => events.push({ type: event.type }))
    expect(events.map((event) => event.type)).toEqual(['message', 'done'])
  })

  it('nudges an undelivered turn up to three times, forcing SendMessage last', async () => {
    const { agent, conversation, turn } = await makeQueuedTurn('Runner Silent')
    scripted.push(
      { text: 'I will just talk instead of delivering.', toolCalls: [] },
      { text: 'still just talking', toolCalls: [] },
      { text: 'more talking', toolCalls: [] },
      { text: 'final talking', toolCalls: [] },
    )
    await drain(agent.id)

    expect(requests).toHaveLength(4)
    for (const request of requests.slice(1)) {
      expect(request.tools).toEqual(['SendMessage'])
    }
    expect(requests[3].toolChoice).toMatchObject({ function: { name: 'SendMessage' } })
    // The turn still settles cleanly with nothing delivered.
    expect((await db.getTurn(turn.id))?.status).toBe('succeeded')
    const rows = await db.listConversationMessages(conversation.id)
    expect(deliveriesOf(rows, turn.id)).toHaveLength(0)
  })

  it('issues one closing-send nudge when a turn ends on silent tool calls', async () => {
    const { agent, conversation, turn } = await makeQueuedTurn('Runner Closing')
    scripted.push(
      { text: '', toolCalls: [sendText('Looking into it.')] },
      { text: '', toolCalls: [toolCall('recallMemory', { query: 'anything' })] },
      { text: 'private conclusion', toolCalls: [] },
      { text: '', toolCalls: [sendText('Here is what I found.')] },
      { text: '', toolCalls: [] },
    )
    await drain(agent.id)

    expect((await db.getTurn(turn.id))?.status).toBe('succeeded')
    const closingRequest = requests[3]
    const lastReminder = [...closingRequest.messages]
      .reverse()
      .find((m) => m.content.startsWith('<system_reminder>'))
    expect(lastReminder?.content).toContain('ended without a follow-up SendMessage')
    const rows = await db.listConversationMessages(conversation.id)
    expect(deliveriesOf(rows, turn.id).map((row) => row.bodyText)).toEqual([
      'Looking into it.',
      'Here is what I found.',
    ])
  })

  it('suspends on a widget, resumes from stored history, and finishes the turn', async () => {
    const { agent, conversation, turn } = await makeQueuedTurn('Runner Widget', 'pick one')
    scripted.push({
      text: '',
      toolCalls: [
        toolCall('SendMessage', {
          type: 'widget',
          widget: { prompt: 'Formal or casual?', options: [{ label: 'Formal' }, { label: 'Casual' }] },
        }),
      ],
    })
    await drain(agent.id)

    const waitingTurn = await db.getTurn(turn.id)
    expect(waitingTurn?.status).toBe('waiting')
    const waiting = db.waitingStateSchema.parse(waitingTurn!.waitingStateJson)
    expect(waiting.prompt).toBe('Formal or casual?')
    expect(waiting.options.map((option) => option.id)).toEqual(['opt_1', 'opt_2'])
    // The stored mid-turn history round-trips through the schema.
    const stored = (waiting.resumeData as { modelMessages: ModelMessage[] }).modelMessages
    expect(stored.some((m) => m.role === 'assistant' && m.tool_calls)).toBe(true)
    expect(stored.some((m) => m.role === 'system')).toBe(false)

    scripted.push(
      { text: '', toolCalls: [sendText('Formal it is.')] },
      { text: '', toolCalls: [] },
    )
    await db.respondToWaitingTurn({
      turnId: turn.id,
      text: 'Formal',
      optionId: 'opt_1',
      toolCallId: waiting.originatingToolCall.id,
    })
    await drain(agent.id)

    expect((await db.getTurn(turn.id))?.status).toBe('succeeded')
    // The resumed request replays: fresh system prompt, stored history, then
    // the user's selection.
    const resumedRequest = requests.at(-2)!
    expect(resumedRequest.messages[0].role).toBe('system')
    expect(resumedRequest.messages.at(-1)).toMatchObject({ role: 'user', content: 'Formal' })
    expect(resumedRequest.messages.some((m) => m.role === 'tool')).toBe(true)

    const rows = await db.listConversationMessages(conversation.id)
    const delivered = deliveriesOf(rows, turn.id)
    expect(delivered.map((row) => row.payloadJson.type)).toEqual(['widget', 'text'])
    // The user's response row is part of the same turn's transcript.
    expect(
      rows.some(
        (row) => row.turnId === turn.id && row.payloadJson.event === 'turn_response',
      ),
    ).toBe(true)
  })

  it('re-executes an interrupted turn without double-sending identical texts', async () => {
    const { agent, conversation, turn } = await makeQueuedTurn('Runner Restart')
    // Simulate the interrupted attempt: one delivery happened, then a crash
    // reset the running turn to queued (attemptCount already 1).
    await db.claimQueuedTurn(turn.id)
    const prior = await db.appendConversationMessage({
      conversationId: conversation.id,
      kind: 'message',
      role: 'assistant',
      direction: 'outbound',
      bodyText: 'Working on it.',
      payload: {
        version: 1,
        deliveryKind: 'send-message',
        type: 'text',
        toolCallId: 'call_prior',
      },
      turnId: turn.id,
    })
    // The same reset the database startup path applies to interrupted turns.
    const client = (db.db as unknown as { $client: { execute: (q: { sql: string; args: unknown[] }) => Promise<unknown> } }).$client
    await client.execute({
      sql: "UPDATE turns SET status = 'queued', started_at = NULL, updated_at = ? WHERE id = ?",
      args: [Date.now(), turn.id],
    })
    expect((await db.getTurn(turn.id))?.status).toBe('queued')

    scripted.push(
      { text: '', toolCalls: [sendText('Working on it.')] },
      { text: '', toolCalls: [sendText('All done.')] },
      { text: '', toolCalls: [] },
    )
    await drain(agent.id)

    expect((await db.getTurn(turn.id))?.status).toBe('succeeded')
    const rows = await db.listConversationMessages(conversation.id)
    const delivered = deliveriesOf(rows, turn.id)
    expect(delivered.map((row) => row.bodyText)).toEqual(['Working on it.', 'All done.'])
    expect(delivered[0].id).toBe(prior.id)
    // The restarted attempt was told what it already delivered.
    expect(
      requests[0].messages.some((m) => m.content.includes('interrupted and restarted')),
    ).toBe(true)
  })
})
