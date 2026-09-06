import assert from 'node:assert/strict'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import type { ModelToolCall } from '@openbot/db'
import type { ToolTurnContext } from './send-message'

const testData = path.resolve(
  process.cwd(),
  '../../.data',
  `react-to-message-tool-tests-${process.pid}`,
)
await rm(testData, { recursive: true, force: true })
process.env.OPENBOT_DATA_DIR = testData

const db = await import('@openbot/db')
const { agentToolDefinitions, executeAgentToolCall } = await import('./index')
const { renderPrivateTurnPrompt } = await import('../prompt/assembly')

function call(messageId: string, emoji: string): ModelToolCall {
  return {
    id: 'call_reaction',
    type: 'function',
    function: {
      name: 'ReactToMessage',
      arguments: JSON.stringify({ message_id: messageId, emoji }),
    },
  }
}

function context(
  conversationId: string,
  onReaction?: ToolTurnContext['onReaction'],
) {
  return { conversationId, onReaction } as ToolTurnContext
}

test('exposes ReactToMessage', () => {
  assert.equal(
    agentToolDefinitions.some((tool) => tool.function.name === 'ReactToMessage'),
    true,
  )
})

test('toggles an agent reaction on a user message', async () => {
  const created = await db.createAgent({ name: 'Reactor' })
  const accepted = await db.acceptUserMessage({
    conversationId: created.conversation.id,
    text: 'Good news!',
  })
  const userMessage = accepted.message
  assert.equal(
    await renderPrivateTurnPrompt({
      conversationId: created.conversation.id,
      turnId: accepted.turn.id,
    }),
    `[message_id: ${userMessage.id}] Good news!`,
  )

  let streamedMessageId: string | undefined
  const applied = JSON.parse(
    await executeAgentToolCall(
      created.agent,
      call(userMessage.id, '🎉'),
      context(created.conversation.id, (message) => {
        streamedMessageId = message.id
      }),
    ),
  )
  assert.equal(applied.ok, true)
  assert.equal(applied.applied, true)
  assert.equal(streamedMessageId, userMessage.id)
  const [stored] = (await db.listConversationMessages(created.conversation.id))[0]!
    .reactionsJson.items
  assert.equal(stored?.reaction, '🎉')
  assert.equal(stored?.actorAgentId, created.agent.id)
  assert.equal(stored?.actorExternalId, null)
  assert.equal(typeof stored?.createdAt, 'number')

  const removed = JSON.parse(
    await executeAgentToolCall(
      created.agent,
      call(userMessage.id, '🎉'),
      context(created.conversation.id),
    ),
  )
  assert.equal(removed.applied, false)
  assert.deepEqual(
    (await db.listConversationMessages(created.conversation.id))[0]?.reactionsJson.items,
    [],
  )
})

test('rejects unknown and non-user targets', async () => {
  const created = await db.createAgent({ name: 'Careful reactor' })
  const assistantMessage = await db.appendConversationMessage({
    conversationId: created.conversation.id,
    kind: 'message',
    role: 'assistant',
    direction: 'outbound',
    senderAgentId: created.agent.id,
    bodyText: 'My own message',
  })

  const unknown = JSON.parse(
    await executeAgentToolCall(
      created.agent,
      call('ent_missing', '👍'),
      context(created.conversation.id),
    ),
  )
  assert.match(unknown.error, /not a user message/)

  const ownMessage = JSON.parse(
    await executeAgentToolCall(
      created.agent,
      call(assistantMessage.id, '👍'),
      context(created.conversation.id),
    ),
  )
  assert.match(ownMessage.error, /not a user message/)
})
