import type { ModelToolCall, ToolDefinition } from '@openbot/db'
import type { ToolTurnContext } from './send-message'
import { computerArgsSchema, screenshotArgsSchema } from './computer-schema'

export const SCREENSHOT_TOOL_NAME = 'Screenshot'
export const COMPUTER_TOOL_NAME = 'Computer'

export const screenshotToolDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: SCREENSHOT_TOOL_NAME,
    description:
      'Capture the current Remote Desktop screen without changing it. Returns the ' +
      'dynamic display dimensions, cursor position, desktop state id, and a persisted image URL.',
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
}

const actionProperties = {
  action: {
    type: 'string',
    enum: ['screenshot', 'click', 'move', 'drag', 'type', 'key', 'scroll', 'wait'],
  },
  x: { type: 'integer', minimum: 0 },
  y: { type: 'integer', minimum: 0 },
  x2: { type: 'integer', minimum: 0 },
  y2: { type: 'integer', minimum: 0 },
  path: {
    type: 'array',
    minItems: 2,
    maxItems: 64,
    items: {
      type: 'object',
      properties: {
        x: { type: 'integer', minimum: 0 },
        y: { type: 'integer', minimum: 0 },
      },
      required: ['x', 'y'],
      additionalProperties: false,
    },
  },
  button: { type: 'string', enum: ['left', 'right', 'middle'] },
  click_count: { type: 'integer', minimum: 1, maximum: 3 },
  text: { type: 'string', minLength: 1, maxLength: 2_000 },
  key: { type: 'string', minLength: 1, maxLength: 256 },
  direction: { type: 'string', enum: ['up', 'down', 'left', 'right'] },
  amount: { type: 'integer', minimum: 1, maximum: 10_000 },
  duration_ms: { type: 'integer', minimum: 0, maximum: 30_000 },
  description: {
    type: 'string',
    minLength: 1,
    maxLength: 500,
    description: 'Purpose and intended visual target. Required for every screen-changing action.',
  },
} as const

export const computerToolDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: COMPUTER_TOOL_NAME,
    description:
      'Control the configured Remote Desktop through validated coordinates. Use Screenshot ' +
      'first to discover the current dimensions and state id; expected_state_id is required ' +
      'for every coordinate action. Every screen-changing action needs a description of its ' +
      'purpose. Supports one action plus up to 9 follow-ups. Mutations may require user ' +
      'approval and automatically return a final persisted screenshot.',
    parameters: {
      type: 'object',
      properties: {
        ...actionProperties,
        expected_state_id: {
          type: 'string',
          description: 'State id returned by the Screenshot used to choose coordinates.',
        },
        then: {
          type: 'array',
          maxItems: 9,
          description: 'Optional bounded follow-up actions, executed in order.',
          items: {
            type: 'object',
            properties: actionProperties,
            required: ['action'],
            additionalProperties: false,
          },
        },
      },
      required: ['action'],
      additionalProperties: false,
    },
  },
}

export const computerToolDefinitions = [screenshotToolDefinition, computerToolDefinition]

export async function executeScreenshotTool(
  call: ModelToolCall,
  args: unknown,
  context: ToolTurnContext | undefined,
) {
  const parsed = screenshotArgsSchema.safeParse(args)
  if (!context?.desktop) {
    return { ok: false, status: 'desktop_unavailable', summary: 'Screenshot is unavailable' }
  }
  if (!parsed.success) {
    return context.desktop.persistInvalid(call.id, SCREENSHOT_TOOL_NAME, parsed.error)
  }
  return context.desktop.screenshot(call.id)
}

export async function executeComputerTool(
  call: ModelToolCall,
  args: unknown,
  context: ToolTurnContext | undefined,
) {
  const parsed = computerArgsSchema.safeParse(args)
  if (!context?.desktop) {
    return { ok: false, status: 'desktop_unavailable', summary: 'Computer is unavailable' }
  }
  if (!parsed.success) {
    return context.desktop.persistInvalid(call.id, COMPUTER_TOOL_NAME, parsed.error)
  }
  return context.desktop.computer(call.id, parsed.data)
}
