// Delivery-contract enforcement for user-visible turns: plain assistant text
// is model-private, so a turn only reaches the user through SendMessage tool
// calls. This module holds the accounting state and the reminder/nudge texts
// the turn runner injects when a turn is going silent. Everything here is
// pure; the runner owns when to call it.

import type { ModelMessage } from '@openbot/db'

// A turn that opens with more than this many tool calls before a text
// SendMessage gets the acknowledgement reminder.
export const ACK_TOOL_CALL_THRESHOLD = 1
// More than this many non-SendMessage tool calls since the last send gets the
// silent-streak reminder.
export const SILENT_TOOL_CALL_THRESHOLD = 6
// After a send, more than this many further silent tool calls gets the
// early-result reminder (once per streak).
export const EARLY_RESULT_THRESHOLD = 0
// A turn that ends with zero deliveries is re-run with the final reply nudge
// up to this many times; the last attempt forces a SendMessage tool choice.
export const MAX_FINAL_REPLY_NUDGES = 3
// Extra rounds granted after the tool budget runs out, offering only
// SendMessage so delivery stays possible.
export const MAX_SEND_ONLY_ROUNDS = 2
// Round budget for the single closing-send re-entry into the tool loop.
export const CLOSING_NUDGE_ROUNDS = 4

export const REPLY_REMINDER =
  'Reply to this message by actually invoking the SendMessage tool — make a ' +
  'real tool/function call, not text you write. Plain assistant text is ' +
  'NEVER delivered; only a real SendMessage tool invocation reaches the ' +
  "user, so if you don't invoke the tool they just see silence."

export const START_OF_TURN_ACK_REMINDER =
  'You opened this turn by calling tools without first acknowledging the ' +
  'user, so they are watching silence and may think the app froze. ' +
  'Acknowledge them RIGHT NOW by actually invoking the SendMessage tool — ' +
  'make a real tool/function call, not text you write. Plain assistant text ' +
  'is NEVER shown to the user; only a real SendMessage tool invocation ' +
  'reaches them. Make that first SendMessage a one-line text ' +
  'acknowledgement, before any further tool call, then continue the work. A ' +
  'widget or attachment does not count as this acknowledgement.'

export const SILENT_TOOL_CALLS_REMINDER =
  'You have made several tool calls without a SendMessage, so the user is ' +
  'currently watching silence. Actually invoke the SendMessage tool now. ' +
  'Send a brief, specific update on what you are doing or what you just ' +
  'found before continuing.'

export const EARLY_RESULT_REMINDER =
  'Remember: the user cannot see tool output or your thinking — only ' +
  'SendMessage reaches them. If you have produced a result or finished what ' +
  'they asked, send it now with a SendMessage tool call before continuing ' +
  'or ending the turn. If you are still mid-task, keep working and send the ' +
  'result once you have it.'

export const FINAL_REPLY_NUDGE =
  "Your previous turn left the user without the result they're waiting on — " +
  'you never called SendMessage that turn, or every SendMessage you tried ' +
  'failed to deliver. Either way they received nothing and are still ' +
  'waiting. Do not assume a send from an earlier turn covered it: an ' +
  'opening acknowledgement back then did not deliver this result (ack ≠ ' +
  'delivery). Deliver the result now by actually invoking the SendMessage ' +
  'tool — make a real tool/function call, not text you write. Plain ' +
  'assistant text is NEVER shown to the user; only a real SendMessage tool ' +
  'invocation reaches them.'

export const CLOSING_SEND_NUDGE =
  'Your previous turn acknowledged the user and then ran tool calls, but ' +
  'ended without a follow-up SendMessage — the last thing the user saw is ' +
  'that opening acknowledgement, so whatever the tool calls produced after ' +
  'it never reached them. If that work produced the result or answer they ' +
  'are waiting on, deliver it now by actually invoking the SendMessage tool ' +
  '— make a real tool/function call, not text you write. If the work is ' +
  'genuinely unfinished, continue it and send the result once you have it.'

export const TOOL_BUDGET_EXHAUSTED_REMINDER =
  'You have used your tool budget for this turn. Deliver your best result ' +
  'to the user now with a SendMessage call — it is the only tool still ' +
  'available this turn.'

export function restartedTurnReminder(deliveredTexts: string[]): string {
  const listed = deliveredTexts
    .map((text) => `- ${text.length > 200 ? `${text.slice(0, 200)}…` : text}`)
    .join('\n')
  return (
    'This turn was interrupted and restarted. You already delivered ' +
    `${deliveredTexts.length} message(s) to the user during the interrupted ` +
    `attempt:\n${listed}\nDo not resend them; continue from where you left ` +
    'off and deliver anything still owed.'
  )
}

const REMINDER_PREFIX = '<system_reminder>'

export function wrapSystemReminder(text: string): ModelMessage {
  return { role: 'user', content: `${REMINDER_PREFIX}\n${text}\n</system_reminder>` }
}

/** Injected reminders are stripped before checkpointing (and never persist). */
export function isSystemReminder(message: ModelMessage): boolean {
  return message.role === 'user' && message.content.startsWith(REMINDER_PREFIX)
}

export type SendMessageType = 'text' | 'widget' | 'attachment'

export type DeliveryState = {
  /** Successful SendMessage deliveries, including prior-attempt rows. */
  sentMessageCount: number
  /** A text send happened (widget/attachment do not satisfy the opening ack). */
  sentTextMessage: boolean
  totalToolCalls: number
  silentToolCallsSinceLastSend: number
  ackReminderIssued: boolean
  silentReminderIssuedThisStreak: boolean
  earlyResultReminderIssuedThisStreak: boolean
}

export function initialDeliveryState(priorDeliveryTypes: string[]): DeliveryState {
  return {
    sentMessageCount: priorDeliveryTypes.length,
    sentTextMessage: priorDeliveryTypes.includes('text'),
    totalToolCalls: 0,
    silentToolCallsSinceLastSend: 0,
    ackReminderIssued: false,
    silentReminderIssuedThisStreak: false,
    earlyResultReminderIssuedThisStreak: false,
  }
}

/** Updates the accounting for one successful delivery. */
export function recordDelivery(state: DeliveryState, type: SendMessageType) {
  state.sentMessageCount += 1
  if (type === 'text') state.sentTextMessage = true
  state.silentToolCallsSinceLastSend = 0
  state.silentReminderIssuedThisStreak = false
  state.earlyResultReminderIssuedThisStreak = false
}

/**
 * The reminder (if any) to inject before the next model round: at most one
 * per round, acknowledgement first, then the silent-streak reminder, then the
 * early-result reminder. Each fires once per turn or per silent streak.
 */
export function planRoundReminder(state: DeliveryState): string | undefined {
  if (
    !state.sentTextMessage &&
    !state.ackReminderIssued &&
    state.totalToolCalls > ACK_TOOL_CALL_THRESHOLD
  ) {
    state.ackReminderIssued = true
    return START_OF_TURN_ACK_REMINDER
  }
  if (
    !state.silentReminderIssuedThisStreak &&
    state.silentToolCallsSinceLastSend > SILENT_TOOL_CALL_THRESHOLD
  ) {
    state.silentReminderIssuedThisStreak = true
    return SILENT_TOOL_CALLS_REMINDER
  }
  if (
    state.sentMessageCount > 0 &&
    !state.earlyResultReminderIssuedThisStreak &&
    state.silentToolCallsSinceLastSend > EARLY_RESULT_THRESHOLD
  ) {
    state.earlyResultReminderIssuedThisStreak = true
    return EARLY_RESULT_REMINDER
  }
  return undefined
}
