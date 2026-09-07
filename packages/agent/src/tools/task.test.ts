import assert from 'node:assert/strict'
import test from 'node:test'
import type { ModelToolCall } from '@openbot/db'
import {
  executeTask,
  executorTaskToolDefinition,
  taskToolDefinition,
  taskArgsSchema,
} from './task'

const call = {
  id: 'call_task',
  type: 'function',
  function: { name: 'Task', arguments: '{}' },
} as ModelToolCall

function context(enqueued: Array<{ kind: string; input: unknown }>) {
  const base = {
    turnId: 'trn_parent',
    conversationId: 'cnv_test',
    senderAgentId: null,
    priorDeliveries: [],
    onDelivered() {},
    async suspend() { return undefined },
    async enqueueBackgroundWake() {},
    async sendDirectAgentMessage() { return { deliveryId: 'del_test', turn: {} as never } },
  }
  const enqueue = (kind: string) => async (input: unknown) => {
    enqueued.push({ kind, input })
    return { turnId: `trn_${kind}` }
  }
  return {
    ...base,
    enqueueGeneralSubagent: enqueue('general'),
    enqueueComputerUseWorker: enqueue('computerUse'),
    enqueueBrowserUseWorker: enqueue('browserUse'),
  }
}

test('Task dispatches each Grok-compatible subagent type', async () => {
  const enqueued: Array<{ kind: string; input: unknown }> = []
  for (const subagent_type of ['executor', 'computerUse', 'browserUse'] as const) {
    const result = await executeTask(
      taskArgsSchema.parse({
        description: `Run ${subagent_type}`,
        prompt: `Run ${subagent_type}`,
        subagent_type,
      }),
      call,
      context(enqueued),
    )
    assert.equal(result.subagent_type, subagent_type)
    assert.equal(result.subagent_id, `trn_${subagent_type === 'executor' ? 'general' : subagent_type}`)
  }
  assert.deepEqual(enqueued.map((entry) => entry.kind), ['general', 'computerUse', 'browserUse'])
})

test('Task uses the Grok description field and canonical executor type', async () => {
  const enqueued: Array<{ kind: string; input: unknown }> = []
  const args = taskArgsSchema.parse({
    description: 'Inspect the queue',
    prompt: 'Inspect the queue\nThen report.',
    subagent_type: 'executor',
  })
  await executeTask(args, call, context(enqueued))
  assert.deepEqual(enqueued[0], {
    kind: 'general',
    input: {
      parentToolCallId: 'call_task',
      task: 'Inspect the queue\nThen report.',
      title: 'Inspect the queue',
    },
  })
  assert.throws(() => taskArgsSchema.parse({
    description: 'Inspect the queue',
    prompt: 'Inspect the queue',
    subagent_type: 'general',
  }))
})

test('desktop-free Task definitions expose only executor', () => {
  const properties = executorTaskToolDefinition.function.parameters.properties as {
    subagent_type: { enum: string[] }
  }
  assert.deepEqual(properties.subagent_type.enum, ['executor'])
})

test('Task uses the Grok delegation and subagent descriptions', () => {
  const description = taskToolDefinition.function.description
  assert.match(description, /Launch a new agent to handle complex, multi-step tasks autonomously/)
  assert.match(description, /specialized subagents that autonomously handle complex tasks/)
  assert.match(description, /When NOT to use the Task tool/)
  assert.match(description, /Available subagent_types and a quick description/)
  assert.match(description, /browserUse: Delegate a self-contained web task/)
  assert.match(description, /computerUse: Delegate a self-contained desktop task/)
  assert.match(description, /Launch multiple executor agents concurrently whenever possible/)
  assert.match(description, /Only one browserUse subagent can run at a time/)
  assert.match(
    executorTaskToolDefinition.function.description,
    /Launch multiple executor agents concurrently whenever possible/,
  )
})
