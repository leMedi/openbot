import assert from 'node:assert/strict'
import { it } from 'node:test'
import { toolTraceFromJsonLines } from './pi-trace'

it('extracts tool arguments and results from a Pi JSONL session', () => {
  const trace = toolTraceFromJsonLines([
    JSON.stringify({ type: 'session', version: 3 }),
    JSON.stringify({
      type: 'message',
      message: {
        role: 'assistant',
        content: [{
          type: 'toolCall',
          id: 'call_search',
          name: 'SearchPlugins',
          arguments: { query: 'ticket issue tracker' },
        }],
      },
    }),
    JSON.stringify({
      type: 'message',
      message: {
        role: 'toolResult',
        toolCallId: 'call_search',
        toolName: 'SearchPlugins',
        content: [{ type: 'text', text: 'linear: Linear — Issues' }],
        isError: false,
      },
    }),
  ].join('\n'))

  assert.deepEqual(trace, [{
    id: 'call_search',
    name: 'SearchPlugins',
    arguments: { query: 'ticket issue tracker' },
    result: { text: 'linear: Linear — Issues', isError: false },
  }])
})

it('keeps failed and corrected calls as separate trace steps', () => {
  const trace = toolTraceFromJsonLines([
    JSON.stringify({
      type: 'message',
      message: {
        role: 'assistant',
        content: [
          { type: 'toolCall', id: 'bad', name: 'SendMessage', arguments: {} },
          { type: 'toolCall', id: 'good', name: 'SendMessage', arguments: { type: 'text' } },
        ],
      },
    }),
    JSON.stringify({
      type: 'message',
      message: {
        role: 'toolResult',
        toolCallId: 'bad',
        content: [{ type: 'text', text: 'invalid' }],
        isError: true,
      },
    }),
    JSON.stringify({
      type: 'message',
      message: {
        role: 'toolResult',
        toolCallId: 'good',
        content: [{ type: 'text', text: 'delivered' }],
        isError: false,
      },
    }),
  ].join('\n'))

  assert.equal(trace[0]?.result?.isError, true)
  assert.equal(trace[1]?.result?.isError, false)
})
