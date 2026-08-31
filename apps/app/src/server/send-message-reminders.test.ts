import { describe, expect, it } from 'vitest'
import {
  EARLY_RESULT_REMINDER,
  initialDeliveryState,
  isSystemReminder,
  planRoundReminder,
  recordDelivery,
  SILENT_TOOL_CALLS_REMINDER,
  START_OF_TURN_ACK_REMINDER,
  wrapSystemReminder,
} from './send-message-reminders'

describe('planRoundReminder', () => {
  it('fires the acknowledgement once after more than one tool call with no text send', () => {
    const state = initialDeliveryState([])
    state.totalToolCalls = 1
    state.silentToolCallsSinceLastSend = 1
    expect(planRoundReminder(state)).toBeUndefined()

    state.totalToolCalls = 2
    state.silentToolCallsSinceLastSend = 2
    expect(planRoundReminder(state)).toBe(START_OF_TURN_ACK_REMINDER)
    // Issued once per turn.
    expect(planRoundReminder(state)).toBeUndefined()
  })

  it('does not ask for an acknowledgement after a text send', () => {
    const state = initialDeliveryState([])
    recordDelivery(state, 'text')
    state.totalToolCalls = 3
    // Early-result may fire instead once tool calls follow the send.
    state.silentToolCallsSinceLastSend = 1
    expect(planRoundReminder(state)).not.toBe(START_OF_TURN_ACK_REMINDER)
  })

  it('a widget or attachment does not satisfy the acknowledgement', () => {
    const state = initialDeliveryState([])
    recordDelivery(state, 'attachment')
    state.totalToolCalls = 2
    state.silentToolCallsSinceLastSend = 2
    expect(planRoundReminder(state)).toBe(START_OF_TURN_ACK_REMINDER)
  })

  it('fires the silent-streak reminder past the threshold and re-arms after a send', () => {
    const state = initialDeliveryState([])
    recordDelivery(state, 'text')
    state.ackReminderIssued = true
    state.earlyResultReminderIssuedThisStreak = true

    state.silentToolCallsSinceLastSend = 6
    expect(planRoundReminder(state)).toBeUndefined()
    state.silentToolCallsSinceLastSend = 7
    expect(planRoundReminder(state)).toBe(SILENT_TOOL_CALLS_REMINDER)
    expect(planRoundReminder(state)).toBeUndefined()

    recordDelivery(state, 'text')
    state.earlyResultReminderIssuedThisStreak = true
    state.silentToolCallsSinceLastSend = 7
    expect(planRoundReminder(state)).toBe(SILENT_TOOL_CALLS_REMINDER)
  })

  it('fires the early-result reminder on the first silent tool call after a send', () => {
    const state = initialDeliveryState([])
    recordDelivery(state, 'text')
    state.ackReminderIssued = true
    expect(planRoundReminder(state)).toBeUndefined()

    state.totalToolCalls = 1
    state.silentToolCallsSinceLastSend = 1
    expect(planRoundReminder(state)).toBe(EARLY_RESULT_REMINDER)
    expect(planRoundReminder(state)).toBeUndefined()
  })

  it('never fires early-result before any delivery', () => {
    const state = initialDeliveryState([])
    state.ackReminderIssued = true
    state.totalToolCalls = 3
    state.silentToolCallsSinceLastSend = 3
    expect(planRoundReminder(state)).toBeUndefined()
  })

  it('seeds accounting from prior-attempt deliveries', () => {
    const state = initialDeliveryState(['text', 'widget'])
    expect(state.sentMessageCount).toBe(2)
    expect(state.sentTextMessage).toBe(true)

    const widgetOnly = initialDeliveryState(['widget'])
    expect(widgetOnly.sentMessageCount).toBe(1)
    expect(widgetOnly.sentTextMessage).toBe(false)
  })
})

describe('system reminder wrapping', () => {
  it('round-trips through the wrapper and detector', () => {
    const wrapped = wrapSystemReminder('do the thing')
    expect(wrapped.role).toBe('user')
    expect(wrapped.content).toContain('do the thing')
    expect(isSystemReminder(wrapped)).toBe(true)
    expect(isSystemReminder({ role: 'user', content: 'hello' })).toBe(false)
    expect(isSystemReminder({ role: 'assistant', content: '<system_reminder>' })).toBe(false)
  })
})
