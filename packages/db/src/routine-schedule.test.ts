import assert from 'node:assert/strict'
import test from 'node:test'
import {
  nextCronOccurrence,
  parseCronExpression,
  validateRoutineSchedule,
} from './routine-schedule'

test('parses five-field cron and resolves it in an IANA timezone', () => {
  parseCronExpression('0,30 9-17/2 * * 1-5')
  const next = nextCronOccurrence(
    '30 9 * * 1-5',
    'America/New_York',
    Date.UTC(2026, 8, 4, 14, 0),
  )
  assert.equal(next, Date.UTC(2026, 8, 7, 13, 30))
})

test('rejects malformed, unknown-timezone, and too-frequent schedules', () => {
  assert.throws(() => parseCronExpression('* * * *'), /five fields/)
  assert.throws(() => validateRoutineSchedule('0 * * * *', 'Mars/Olympus'), /timezone/)
  assert.throws(
    () => validateRoutineSchedule('*/5 * * * *', 'UTC'),
    /at least 15 minutes/,
  )
  assert.throws(
    () => validateRoutineSchedule('0,10 * * * *', 'UTC'),
    /at least 15 minutes/,
  )
  assert.throws(
    () => validateRoutineSchedule('0,50 1,3 * * *', 'America/New_York'),
    /at least 15 minutes/,
  )
  assert.doesNotThrow(() => validateRoutineSchedule('*/15 * * * *', 'UTC'))
})

test('uses standard cron OR semantics for restricted month and weekday days', () => {
  const next = nextCronOccurrence(
    '0 8 13 * 1',
    'UTC',
    Date.UTC(2026, 8, 7, 8, 0), // Monday, after this occurrence
  )
  assert.equal(next, Date.UTC(2026, 8, 13, 8, 0)) // Sunday the 13th
})
