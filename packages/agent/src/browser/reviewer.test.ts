import assert from 'node:assert/strict'
import test from 'node:test'
import type { Message } from '@earendil-works/pi-ai'
import type { ModelRuntime } from '@earendil-works/pi-coding-agent'
import {
  BROWSER_REVIEW_SYSTEM_PROMPT,
  createPiBrowserReviewer,
  projectBrowserReviewContext,
} from './reviewer'

const messages = [
  { role: 'user', content: 'old request', timestamp: 1 },
  { role: 'assistant', content: [{ type: 'text', text: 'old reply' }] },
  { role: 'user', content: 'Open the requested listing', timestamp: 2 },
  {
    role: 'assistant',
    content: [
      { type: 'text', text: 'I will inspect it.' },
      { type: 'toolCall', id: 'call_snapshot', name: 'browser_snapshot', arguments: {} },
    ],
  },
  {
    role: 'toolResult',
    toolCallId: 'call_snapshot',
    toolName: 'browser_snapshot',
    content: [{ type: 'text', text: '[ref=e1] Listing' }],
    isError: false,
  },
  {
    role: 'user',
    content: '[The user approved the exact pending browser_click action. Call it again with unchanged arguments.]',
    timestamp: 3,
  },
  {
    role: 'assistant',
    content: [{
      type: 'toolCall',
      id: 'call_click',
      name: 'browser_click',
      arguments: { ref: 'e1', element: 'Listing' },
    }],
  },
] as unknown as Message[]

test('projects bounded worker-local authorization context', () => {
  const projected = projectBrowserReviewContext(messages)
  assert.deepEqual(projected.filter((message) => message.role === 'user').map((m) => m.content), [
    'old request',
    'Open the requested listing',
  ])
  assert.deepEqual(projected.filter((message) => message.role === 'assistant').map((m) => m.content), [
    'old reply',
    'I will inspect it.',
  ])
  assert.equal(projected.filter((message) => message.role === 'user_answer').length, 1)
  assert.match(BROWSER_REVIEW_SYSTEM_PROMPT, /never authorizes the proposed action/)
  const browser = projected.find((message) => message.role === 'browser')
  assert.match(browser?.content ?? '', /browser_snapshot/)
  assert.match(browser?.content ?? '', /\[ref=e1\] Listing/)
  assert.equal(projected.filter((message) => message.role === 'browser').length, 2)
})

test('uses strict classifier JSON and the configured model runtime', async () => {
  let received: unknown
  let options: unknown
  const runtime = {
    completeSimple: async (_model: unknown, context: unknown, requestOptions: unknown) => {
      received = context
      options = requestOptions
      return {
        stopReason: 'stop',
        content: [{ type: 'text', text: '{"decision":"allow","reason":"Requested navigation"}' }],
      }
    },
  } as unknown as ModelRuntime
  const review = createPiBrowserReviewer({
    runtime,
    model: {
      provider: 'opencode-go',
      id: 'orchestrator',
      baseUrl: 'https://opencode.ai/zen/go/v1',
    } as never,
    sessionId: 'trn_browser_review',
    getMessages: () => messages,
  })
  const decision = await review({
    toolCallId: 'call_navigate',
    name: 'browser_navigate',
    args: { url: 'https://example.com' },
    summary: 'navigate to https://example.com',
    fingerprint: 'fingerprint',
    stateId: 'state',
    targetPageUrl: 'https://before.example/',
  }, new AbortController().signal)
  assert.deepEqual(decision, {
    kind: 'allow',
    reason: 'Requested navigation',
    model: 'opencode-go/orchestrator',
  })
  assert.match(JSON.stringify(received), /Open the requested listing/)
  assert.deepEqual((options as { headers?: unknown }).headers, {
    'x-opencode-session': 'trn_browser_review',
    'x-opencode-client': 'openbot',
  })
})

test('rejects malformed classifier output for manual review', async () => {
  const runtime = {
    completeSimple: async () => ({
      stopReason: 'stop',
      content: [{ type: 'text', text: '```json\n{"decision":"allow"}\n```' }],
    }),
  } as unknown as ModelRuntime
  const review = createPiBrowserReviewer({
    runtime,
    model: { provider: 'provider', id: 'orchestrator' } as never,
    sessionId: 'trn_browser_review',
    getMessages: () => [],
  })
  const decision = await review({
    toolCallId: 'call',
    name: 'browser_click',
    args: { ref: 'e1', element: 'Requested button' },
    summary: 'click requested button',
    fingerprint: 'fingerprint',
    stateId: 'state',
  }, new AbortController().signal)
  assert.equal(decision.kind, 'reject')
})
