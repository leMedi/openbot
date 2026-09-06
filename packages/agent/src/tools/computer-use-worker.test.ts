import assert from 'node:assert/strict'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import type { Agent, ModelToolCall } from '@openbot/db'
import type { ToolTurnContext } from './send-message'

const testData = path.resolve(
  process.cwd(),
  '../../.data',
  `computer-use-worker-tool-tests-${process.pid}`,
)
await rm(testData, { recursive: true, force: true })
process.env.OPENBOT_DATA_DIR = testData

const {
  agentToolDefinitions,
  backgroundToolDefinitions,
  computerUseWorkerToolDefinitions,
  executeAgentToolCall,
} = await import('./index')

const agent = {
  id: 'agt_test',
  name: 'Test',
} as Agent

function toolCall(args: unknown, id = 'call_worker'): ModelToolCall {
  return {
    id,
    type: 'function',
    function: { name: 'computerUse', arguments: JSON.stringify(args) },
  }
}

test('scopes mutating computer control to the computer-use worker', () => {
  assert.deepEqual(
    agentToolDefinitions.map((tool) => tool.function.name),
    [
      'SendMessage',
      'SendAgentMessage',
      'updateMemory',
      'recallMemory',
      'runShell',
      'Read',
      'AwaitShell',
      'Screenshot',
      'computerUse',
    ],
  )
  assert.deepEqual(
    computerUseWorkerToolDefinitions.map((tool) => tool.function.name),
    ['runShell', 'Read', 'AwaitShell', 'Screenshot', 'Computer'],
  )
  assert.equal(
    backgroundToolDefinitions.some((tool) => tool.function.name === 'computerUse'),
    false,
  )
  assert.equal(
    backgroundToolDefinitions.some((tool) => tool.function.name === 'Computer'),
    false,
  )
})

test('delegates a self-contained task through the turn context', async () => {
  let received: unknown
  const result = JSON.parse(
    await executeAgentToolCall(agent, toolCall({ task: 'Open Settings and verify Wi-Fi.' }), {
      turnId: 'trn_parent',
      conversationId: 'con_test',
      senderAgentId: null,
      priorDeliveries: [],
      onDelivered: () => {},
      suspend: async () => undefined,
      enqueueBackgroundWake: async () => {},
      enqueueComputerUseWorker: async (input) => {
        received = input
        return { turnId: 'trn_worker' }
      },
      sendDirectAgentMessage: async () => {
        throw new Error('not used')
      },
    }),
  )

  assert.deepEqual(received, {
    parentToolCallId: 'call_worker',
    task: 'Open Settings and verify Wi-Fi.',
    title: 'Open Settings and verify Wi-Fi.',
  })
  assert.equal(result.status, 'queued')
  assert.equal(result.worker_turn_id, 'trn_worker')
})

test('rejects unavailable and invalid computer-use delegation', async () => {
  const unavailable = JSON.parse(
    await executeAgentToolCall(agent, toolCall({ task: 'Open Settings' })),
  )
  assert.match(unavailable.error, /unavailable/)

  const invalid = JSON.parse(
    await executeAgentToolCall(agent, toolCall({ task: '' })),
  )
  assert.match(invalid.error, /Invalid arguments/)
})

test('limits legacy parent Computer access to one resumed call', async () => {
  let available = true
  let executions = 0
  const context = {
    desktop: {
      computer: async () => {
        executions += 1
        return { ok: true }
      },
    },
    allowComputerCall: () => {
      if (!available) return false
      available = false
      return true
    },
  } as unknown as ToolTurnContext
  const call = (id: string): ModelToolCall => ({
    id,
    type: 'function',
    function: {
      name: 'Computer',
      arguments: JSON.stringify({ action: 'wait', duration_ms: 1 }),
    },
  })

  assert.equal(JSON.parse(await executeAgentToolCall(agent, call('first'), context)).ok, true)
  const second = JSON.parse(await executeAgentToolCall(agent, call('second'), context))
  assert.match(second.summary, /one previously approved action/)
  assert.equal(executions, 1)
})
