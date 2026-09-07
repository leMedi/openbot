import * as z from 'zod'

const FIELD_LIMITS = [
  { min: 0, max: 59, label: 'minute' },
  { min: 0, max: 23, label: 'hour' },
  { min: 1, max: 31, label: 'day of month' },
  { min: 1, max: 12, label: 'month' },
  { min: 0, max: 7, label: 'day of week' },
] as const

export const MIN_ROUTINE_CADENCE_MS = 15 * 60 * 1_000

type ParsedField = { values: Set<number>; wildcard: boolean }
type ParsedCron = [ParsedField, ParsedField, ParsedField, ParsedField, ParsedField]

function parseInteger(value: string, label: string) {
  if (!/^\d+$/.test(value)) throw new Error(`Invalid ${label} value: ${value}`)
  return Number(value)
}

function parseField(source: string, index: number): ParsedField {
  const { min, max, label } = FIELD_LIMITS[index]!
  const values = new Set<number>()
  const wildcard = source === '*' || source.startsWith('*/')
  for (const item of source.split(',')) {
    if (!item) throw new Error(`Invalid ${label} field`)
    const [rangeSource, stepSource, extra] = item.split('/')
    if (extra !== undefined || !rangeSource) throw new Error(`Invalid ${label} field`)
    const step = stepSource === undefined ? 1 : parseInteger(stepSource, `${label} step`)
    if (step < 1) throw new Error(`${label} step must be positive`)
    let start: number
    let end: number
    if (rangeSource === '*') {
      start = min
      end = max
    } else if (rangeSource.includes('-')) {
      const [startSource, endSource, rangeExtra] = rangeSource.split('-')
      if (rangeExtra !== undefined || !startSource || !endSource) {
        throw new Error(`Invalid ${label} range`)
      }
      start = parseInteger(startSource, label)
      end = parseInteger(endSource, label)
      if (start > end) throw new Error(`${label} range must increase`)
    } else {
      start = parseInteger(rangeSource, label)
      end = start
      if (stepSource !== undefined) throw new Error(`${label} step requires * or a range`)
    }
    if (start < min || end > max) {
      throw new Error(`${label} must be between ${min} and ${max}`)
    }
    for (let value = start; value <= end; value += step) {
      values.add(index === 4 && value === 7 ? 0 : value)
    }
  }
  if (values.size === 0) throw new Error(`Empty ${label} field`)
  return { values, wildcard }
}

export function parseCronExpression(expression: string): ParsedCron {
  const fields = expression.trim().split(/\s+/)
  if (fields.length !== 5) throw new Error('Cron must have exactly five fields')
  return fields.map((field, index) => parseField(field!, index)) as ParsedCron
}

export function isIanaTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format()
    return true
  } catch {
    return false
  }
}

const formatters = new Map<string, Intl.DateTimeFormat>()
function localParts(timestamp: number, timezone: string) {
  let formatter = formatters.get(timezone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      calendar: 'gregory',
      numberingSystem: 'latn',
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      weekday: 'short',
    })
    formatters.set(timezone, formatter)
  }
  const parts = Object.fromEntries(
    formatter.formatToParts(timestamp).map((part) => [part.type, part.value]),
  )
  const weekdays: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  }
  return {
    minute: Number(parts.minute),
    hour: Number(parts.hour),
    day: Number(parts.day),
    month: Number(parts.month),
    weekday: weekdays[parts.weekday!]!,
  }
}

function matches(parsed: ParsedCron, timestamp: number, timezone: string) {
  const local = localParts(timestamp, timezone)
  const dayOfMonthMatches = parsed[2].values.has(local.day)
  const dayOfWeekMatches = parsed[4].values.has(local.weekday)
  const dayMatches = parsed[2].wildcard
    ? dayOfWeekMatches
    : parsed[4].wildcard
      ? dayOfMonthMatches
      : dayOfMonthMatches || dayOfWeekMatches
  return parsed[0].values.has(local.minute)
    && parsed[1].values.has(local.hour)
    && dayMatches
    && parsed[3].values.has(local.month)
}

function calendarDayMatches(parsed: ParsedCron, date: Date) {
  const dayOfMonthMatches = parsed[2].values.has(date.getUTCDate())
  const dayOfWeekMatches = parsed[4].values.has(date.getUTCDay())
  return parsed[3].values.has(date.getUTCMonth() + 1) && (
    parsed[2].wildcard
      ? dayOfWeekMatches
      : parsed[4].wildcard
        ? dayOfMonthMatches
        : dayOfMonthMatches || dayOfWeekMatches
  )
}

function minimumScheduledGap(parsed: ParsedCron) {
  const times = [...parsed[1].values]
    .flatMap((hour) => [...parsed[0].values].map((minute) => hour * 60 + minute))
    .sort((a, b) => a - b)
  let minimum = Number.POSITIVE_INFINITY
  for (let index = 1; index < times.length; index += 1) {
    minimum = Math.min(minimum, times[index]! - times[index - 1]!)
  }

  // The Gregorian date/weekday pattern repeats every 400 years. Check that
  // complete cycle to determine whether the overnight gap can ever occur on
  // two consecutive matching dates.
  let previousMatched = false
  for (
    let timestamp = Date.UTC(2000, 0, 1);
    timestamp < Date.UTC(2400, 0, 1);
    timestamp += 24 * 60 * 60 * 1_000
  ) {
    const matched = calendarDayMatches(parsed, new Date(timestamp))
    if (matched && previousMatched) {
      minimum = Math.min(minimum, 24 * 60 - times.at(-1)! + times[0]!)
      break
    }
    previousMatched = matched
  }
  return minimum
}

function timezoneOffsetMinutes(timestamp: number, timezone: string) {
  const formatter = formatters.get(timezone)!
  const parts = Object.fromEntries(
    formatter.formatToParts(timestamp).map((part) => [part.type, part.value]),
  )
  const localAsUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
  )
  return (localAsUtc - timestamp) / 60_000
}

function minimumTransitionGap(parsed: ParsedCron, timezone: string) {
  // Wall-clock validation above covers ordinary days. Around offset changes,
  // scan actual UTC minutes so a spring-forward compression cannot create a
  // sub-limit real-time cadence. Ten projected years cover the full weekday
  // and leap-year cycle used by recurring timezone rules.
  localParts(Date.now(), timezone) // Prime the shared formatter.
  const currentYear = new Date().getUTCFullYear()
  const start = Date.UTC(currentYear - 1, 0, 1)
  const end = Date.UTC(currentYear + 10, 0, 1)
  const step = 12 * 60 * 60 * 1_000
  let previousOffset = timezoneOffsetMinutes(start, timezone)
  let minimum = Number.POSITIVE_INFINITY
  for (let cursor = start + step; cursor <= end; cursor += step) {
    const offset = timezoneOffsetMinutes(cursor, timezone)
    if (offset !== previousOffset) {
      let previousMatch: number | undefined
      for (
        let candidate = cursor - 48 * 60 * 60 * 1_000;
        candidate <= cursor + 48 * 60 * 60 * 1_000;
        candidate += 60_000
      ) {
        if (!matches(parsed, candidate, timezone)) continue
        if (previousMatch !== undefined) {
          minimum = Math.min(minimum, candidate - previousMatch)
        }
        previousMatch = candidate
      }
    }
    previousOffset = offset
  }
  return minimum
}

const MAX_SEARCH_MINUTES = 366 * 24 * 60 * 5

export function nextCronOccurrence(
  expression: string,
  timezone: string,
  after: number,
): number {
  if (!isIanaTimezone(timezone)) throw new Error(`Unknown timezone: ${timezone}`)
  const parsed = parseCronExpression(expression)
  let candidate = Math.floor(after / 60_000) * 60_000 + 60_000
  for (let index = 0; index < MAX_SEARCH_MINUTES; index += 1) {
    if (matches(parsed, candidate, timezone)) return candidate
    candidate += 60_000
  }
  throw new Error('Cron has no occurrence in the next five years')
}

export function validateRoutineSchedule(expression: string, timezone: string) {
  if (!isIanaTimezone(timezone)) throw new Error(`Unknown timezone: ${timezone}`)
  const parsed = parseCronExpression(expression)
  const anchor = Date.UTC(2023, 11, 31, 0, 0, 0)
  const first = nextCronOccurrence(expression, timezone, anchor)
  if (
    minimumScheduledGap(parsed) * 60_000 < MIN_ROUTINE_CADENCE_MS ||
    minimumTransitionGap(parsed, timezone) < MIN_ROUTINE_CADENCE_MS
  ) {
    throw new Error('Routine schedules must be at least 15 minutes apart')
  }
  return { expression: expression.trim(), timezone, nextRunAt: first }
}

export const routineDefinitionInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  instruction: z.string().trim().min(1).max(20_000),
  cronExpression: z.string().trim().min(1).max(100),
  timezone: z.string().trim().min(1).max(100),
})
