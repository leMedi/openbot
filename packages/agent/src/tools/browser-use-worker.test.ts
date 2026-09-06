import assert from 'node:assert/strict'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import type { Agent, ModelToolCall } from '@openbot/db'
import type { ToolTurnContext } from './send-message'

const testData = path.resolve(process.cwd(), '../../.data', `browser-worker-tools-${process.pid}`)
await rm(testData, { recursive: true, force: true })
process.env.OPENBOT_DATA_DIR = testData

const {
  agentToolDefinitions,
  backgroundToolDefinitions,
  browserUseWorkerToolDefinitions,
  computerUseWorkerToolDefinitions,
  executeAgentToolCall,
} = await import('./index')
const { browserToolArgsSchemas } = await import('./browser')

const browserNames = [
  'browser_navigate',
  'browser_snapshot',
  'browser_click',
  'browser_mouse_click_xy',
  'browser_type',
  'browser_fill',
  'browser_select_option',
  'browser_press_key',
  'browser_scroll',
  'browser_drag',
  'browser_get_bounding_box',
  'browser_highlight',
  'browser_cdp',
  'browser_tabs',
  'browser_take_screenshot',
]

const agent = { id: 'agt_browser_test', name: 'Browser test' } as Agent

function toolCall(args: unknown): ModelToolCall {
  return {
    id: 'call_browser_worker',
    type: 'function',
    function: { name: 'browserUse', arguments: JSON.stringify(args) },
  }
}

test('exposes delegation only to ordinary turns and gives browser workers the exact narrow surface', () => {
  assert.equal(agentToolDefinitions.some((tool) => tool.function.name === 'browserUse'), true)
  assert.equal(backgroundToolDefinitions.some((tool) => tool.function.name === 'browserUse'), false)
  assert.deepEqual(
    browserUseWorkerToolDefinitions.map((tool) => tool.function.name),
    ['runShell', 'Read', 'AwaitShell', 'Screenshot', ...browserNames],
  )
  for (const forbidden of [
    'Computer',
    'SendMessage',
    'SendAgentMessage',
    'browserUse',
    'computerUse',
    'updateMemory',
    'recallMemory',
  ]) {
    assert.equal(browserUseWorkerToolDefinitions.some((tool) => tool.function.name === forbidden), false)
  }
  assert.equal(
    computerUseWorkerToolDefinitions.some((tool) => tool.function.name.startsWith('browser_')),
    false,
  )
})

test('delegates a self-contained browser task through the turn context', async () => {
  let received: unknown
  const context = {
    enqueueBrowserUseWorker: async (input: unknown) => {
      received = input
      return { turnId: 'trn_browser_worker' }
    },
  } as ToolTurnContext
  const result = JSON.parse(
    await executeAgentToolCall(agent, toolCall({ task: 'Open https://example.com and report the title.' }), context),
  )
  assert.deepEqual(received, {
    parentToolCallId: 'call_browser_worker',
    task: 'Open https://example.com and report the title.',
    title: 'Open https://example.com and report the title.',
  })
  assert.equal(result.status, 'queued')
  assert.equal(result.worker_turn_id, 'trn_browser_worker')
})

test('rejects unavailable and invalid browser delegation', async () => {
  const unavailable = JSON.parse(await executeAgentToolCall(agent, toolCall({ task: 'Open a page' })))
  assert.match(unavailable.error, /unavailable/)
  const invalid = JSON.parse(await executeAgentToolCall(agent, toolCall({ task: '', extra: true })))
  assert.match(invalid.error, /Invalid arguments/)
})

test('strictly validates arguments for every browser tool', () => {
  const valid: Record<string, unknown> = {
    browser_navigate: { url: 'https://example.com' },
    browser_snapshot: {},
    browser_click: { ref: 'e1', element: 'Open the item' },
    browser_mouse_click_xy: { x: 1, y: 2, element: 'Open the item' },
    browser_type: { ref: 'e1', text: 'value' },
    browser_fill: { ref: 'e1', value: 'value' },
    browser_select_option: { ref: 'e1', values: ['one'] },
    browser_press_key: { key: 'Enter' },
    browser_scroll: { direction: 'down' },
    browser_drag: { sourceRef: 'e1', targetRef: 'e2', element: 'Move the item' },
    browser_get_bounding_box: { ref: 'e1' },
    browser_highlight: { ref: 'e1' },
    browser_cdp: { method: 'Runtime.evaluate', params: { expression: '1 + 1' } },
    browser_tabs: { action: 'list' },
    browser_take_screenshot: {},
  }
  assert.deepEqual(Object.keys(browserToolArgsSchemas), browserNames)
  for (const name of browserNames) {
    const schema = browserToolArgsSchemas[name as keyof typeof browserToolArgsSchemas]
    assert.equal(schema.safeParse(valid[name]).success, true, name)
    assert.equal(
      schema.safeParse({ ...(valid[name] as Record<string, unknown>), display: 7 }).success,
      false,
      `${name} accepted trusted host configuration`,
    )
  }
})
