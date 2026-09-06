import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  SERVER_LOG_CAPACITY,
  appendServerLog,
  installServerLogCapture,
  listServerLogs,
  subscribeServerLogs,
} from './logs.ts'
import { formatServerLogs } from '../lib/server-logs.ts'

test('captures console output with a level and notifies subscribers', () => {
  installServerLogCapture()
  const received: string[] = []
  const before = listServerLogs().at(-1)?.id ?? 0
  const unsubscribe = subscribeServerLogs((entry) => received.push(`${entry.level}:${entry.message}`))
  console.warn('slack rate limit near %s', '82%')
  unsubscribe()
  assert.deepEqual(received, ['warn:slack rate limit near 82%'])
  assert.deepEqual(listServerLogs(before).map((item) => item.message), ['slack rate limit near 82%'])
})

test('keeps only the most recent entries', () => {
  for (let index = 0; index < SERVER_LOG_CAPACITY + 20; index++) appendServerLog('info', `line ${index}`)
  const entries = listServerLogs()
  assert.equal(entries.length, SERVER_LOG_CAPACITY)
  assert.equal(entries.at(-1)?.message, `line ${SERVER_LOG_CAPACITY + 19}`)
})

test('formats entries as downloadable text', () => {
  const text = formatServerLogs([{ id: 1, time: '2026-09-06T10:00:00.000Z', level: 'info', message: 'ready' }])
  assert.equal(text, '2026-09-06T10:00:00.000Z INFO  ready')
})
