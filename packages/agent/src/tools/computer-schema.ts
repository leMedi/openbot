import * as z from 'zod'
import type { DesktopAction, DesktopDisplay, DesktopPoint } from '../desktop/driver'

const coordinate = z.number().int().nonnegative()
const description = z.string().trim().min(1).max(500)
const pointSchema = z.object({ x: coordinate, y: coordinate }).strict()

const screenshotActionSchema = z.object({ action: z.literal('screenshot') }).strict()
const clickActionSchema = z
  .object({
    action: z.literal('click'),
    x: coordinate,
    y: coordinate,
    button: z.enum(['left', 'right', 'middle']).default('left'),
    click_count: z.number().int().min(1).max(3).default(1),
    description,
  })
  .strict()
const moveActionSchema = z
  .object({
    action: z.literal('move'),
    x: coordinate,
    y: coordinate,
    description,
  })
  .strict()
const dragActionSchema = z
  .object({
    action: z.literal('drag'),
    x: coordinate.optional(),
    y: coordinate.optional(),
    x2: coordinate.optional(),
    y2: coordinate.optional(),
    path: z.array(pointSchema).min(2).max(64).optional(),
    button: z.enum(['left', 'right', 'middle']).default('left'),
    description,
  })
  .strict()
  .superRefine((value, context) => {
    const coordinatePath = [value.x, value.y, value.x2, value.y2]
    const hasAnyCoordinate = coordinatePath.some((coordinateValue) => coordinateValue !== undefined)
    const hasEveryCoordinate = coordinatePath.every((coordinateValue) => coordinateValue !== undefined)
    if ((!value.path && !hasEveryCoordinate) || (value.path && hasAnyCoordinate)) {
      context.addIssue({
        code: 'custom',
        message: 'drag requires either x/y/x2/y2 or path, but not both',
      })
    }
  })
const typeActionSchema = z
  .object({
    action: z.literal('type'),
    text: z.string().min(1).max(2_000),
    description,
  })
  .strict()
const keyActionSchema = z
  .object({
    action: z.literal('key'),
    key: z.string().trim().min(1).max(256),
    description,
  })
  .strict()
const scrollActionSchema = z
  .object({
    action: z.literal('scroll'),
    direction: z.enum(['up', 'down', 'left', 'right']),
    amount: z.number().int().min(1).max(10_000),
    x: coordinate.optional(),
    y: coordinate.optional(),
    description,
  })
  .strict()
  .refine((value) => (value.x === undefined) === (value.y === undefined), {
    message: 'scroll x and y must be provided together',
  })
const waitActionSchema = z
  .object({
    action: z.literal('wait'),
    duration_ms: z.number().int().min(0).max(30_000),
  })
  .strict()

export const computerActionSchema = z.union([
  screenshotActionSchema,
  clickActionSchema,
  moveActionSchema,
  dragActionSchema,
  typeActionSchema,
  keyActionSchema,
  scrollActionSchema,
  waitActionSchema,
])

export const screenshotArgsSchema = z.object({}).strict()

export const computerArgsSchema = z
  .object({
    action: z.enum(['screenshot', 'click', 'move', 'drag', 'type', 'key', 'scroll', 'wait']),
    x: coordinate.optional(),
    y: coordinate.optional(),
    x2: coordinate.optional(),
    y2: coordinate.optional(),
    path: z.array(pointSchema).min(2).max(64).optional(),
    button: z.enum(['left', 'right', 'middle']).optional(),
    click_count: z.number().int().min(1).max(3).optional(),
    text: z.string().min(1).max(2_000).optional(),
    key: z.string().trim().min(1).max(256).optional(),
    direction: z.enum(['up', 'down', 'left', 'right']).optional(),
    amount: z.number().int().min(1).max(10_000).optional(),
    duration_ms: z.number().int().min(0).max(30_000).optional(),
    description: description.optional(),
    expected_state_id: z.string().trim().min(1).max(200).optional(),
    then: z.array(computerActionSchema).max(9).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const { then: _then, expected_state_id: _state, ...primary } = value
    const parsed = computerActionSchema.safeParse(primary)
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        context.addIssue({ ...issue, path: issue.path })
      }
    }
    const actions = [primary, ...(value.then ?? [])]
    const hasCoordinates = actions.some((action) =>
      ['click', 'move', 'drag', 'scroll'].includes(action.action),
    )
    if (hasCoordinates && !value.expected_state_id) {
      context.addIssue({
        code: 'custom',
        path: ['expected_state_id'],
        message:
          'expected_state_id is required for coordinate actions; call Screenshot before choosing coordinates',
      })
    }
  })

export type ComputerArgs = z.infer<typeof computerArgsSchema>

function normalizeAction(value: z.infer<typeof computerActionSchema>): DesktopAction {
  switch (value.action) {
    case 'screenshot':
      return { action: 'screenshot' }
    case 'click':
      return {
        action: 'click',
        x: value.x,
        y: value.y,
        button: value.button,
        clickCount: value.click_count,
        description: value.description,
      }
    case 'move':
      return {
        action: 'move',
        x: value.x,
        y: value.y,
        description: value.description,
      }
    case 'drag': {
      const path: DesktopPoint[] = value.path ?? [
        { x: value.x as number, y: value.y as number },
        { x: value.x2 as number, y: value.y2 as number },
      ]
      return {
        action: 'drag',
        path,
        button: value.button,
        description: value.description,
      }
    }
    case 'type':
      return {
        action: 'type',
        text: value.text,
        description: value.description,
      }
    case 'key':
      return {
        action: 'key',
        key: value.key,
        description: value.description,
      }
    case 'scroll':
      return {
        action: 'scroll',
        direction: value.direction,
        amount: value.amount,
        ...(value.x !== undefined && value.y !== undefined
          ? { at: { x: value.x, y: value.y } }
          : {}),
        description: value.description,
      }
    case 'wait':
      return { action: 'wait', durationMs: value.duration_ms }
  }
}

export function normalizeComputerArgs(args: ComputerArgs) {
  const { then = [], expected_state_id: expectedStateId, ...primary } = args
  const parsedPrimary = computerActionSchema.parse(primary)
  return {
    actions: [parsedPrimary, ...then].map(normalizeAction),
    expectedStateId,
  }
}

function pointsOf(action: DesktopAction): DesktopPoint[] {
  switch (action.action) {
    case 'click':
    case 'move':
      return [{ x: action.x, y: action.y }]
    case 'drag':
      return action.path
    case 'scroll':
      return action.at ? [action.at] : []
    default:
      return []
  }
}

export function validateDisplayBounds(actions: readonly DesktopAction[], display: DesktopDisplay) {
  for (const [actionIndex, action] of actions.entries()) {
    for (const point of pointsOf(action)) {
      if (point.x >= display.width || point.y >= display.height) {
        return (
          `Action ${actionIndex + 1} ${action.action} coordinate ` +
          `(${point.x}, ${point.y}) is outside the ${display.width}×${display.height} desktop`
        )
      }
    }
  }
  return undefined
}

export const REVIEWED_ACTIONS = new Set<DesktopAction['action']>([
  'click',
  'drag',
  'type',
  'key',
])

export const SCREEN_CHANGING_ACTIONS = new Set<DesktopAction['action']>([
  'click',
  'move',
  'drag',
  'type',
  'key',
  'scroll',
])

export function actionSummary(actions: readonly DesktopAction[]) {
  return actions
    .map((action) => {
      if (action.action === 'click') return `click (${action.x}, ${action.y})`
      if (action.action === 'move') return `move (${action.x}, ${action.y})`
      if (action.action === 'drag') {
        const start = action.path[0]
        const end = action.path.at(-1)!
        return `drag (${start.x}, ${start.y}) to (${end.x}, ${end.y})`
      }
      if (action.action === 'type') return `type ${action.text.length} characters`
      if (action.action === 'key') return `press ${action.key}`
      if (action.action === 'scroll') return `scroll ${action.direction} ${action.amount}`
      if (action.action === 'wait') return `wait ${action.durationMs}ms`
      return 'screenshot'
    })
    .join(', ')
}
