import type { BrowserOperationRequest, JsonValue } from '@openbot/browser-driver'
import type { ModelToolCall, ToolDefinition } from '@openbot/db'
import * as z from 'zod'
import type { ToolTurnContext } from './send-message'

const viewIdSchema = z.string().trim().min(1).max(500).optional()
const elementSchema = z.string().trim().min(1).max(500).optional()
const refSchema = z.string().trim().min(1).max(500)
const buttonSchema = z.enum(['left', 'right', 'middle']).optional()
const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number(),
    z.string(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
)

export const browserToolArgsSchemas = {
  browser_navigate: z.object({
    url: z.string().trim().min(1).max(20_000),
    viewId: viewIdSchema,
    newTab: z.boolean().optional(),
  }).strict(),
  browser_snapshot: z.object({
    viewId: viewIdSchema,
    interactive: z.boolean().optional(),
    maxDepth: z.number().int().min(0).max(100).optional(),
    selector: z.string().trim().min(1).max(2_000).optional(),
  }).strict(),
  browser_click: z.object({
    ref: refSchema,
    element: elementSchema,
    offsetX: z.number().finite().optional(),
    offsetY: z.number().finite().optional(),
    doubleClick: z.boolean().optional(),
    button: buttonSchema,
    modifiers: z.array(z.enum(['Control', 'Shift', 'Alt', 'Meta', 'ControlOrMeta'])).max(4).optional(),
    holdDurationMs: z.number().finite().min(0).max(5_000).optional(),
    viewId: viewIdSchema,
  }).strict(),
  browser_mouse_click_xy: z.object({
    x: z.number().finite(),
    y: z.number().finite(),
    element: elementSchema,
    button: buttonSchema,
    viewId: viewIdSchema,
  }).strict(),
  browser_type: z.object({
    ref: refSchema,
    text: z.string().max(20_000),
    element: elementSchema,
    clear: z.boolean().optional(),
    submit: z.boolean().optional(),
    slowly: z.boolean().optional(),
    viewId: viewIdSchema,
  }).strict(),
  browser_fill: z.object({
    ref: refSchema,
    value: z.string().max(20_000),
    element: elementSchema,
    viewId: viewIdSchema,
  }).strict(),
  browser_select_option: z.object({
    ref: refSchema,
    values: z.array(z.string().max(2_000)).min(1).max(100),
    element: elementSchema,
    viewId: viewIdSchema,
  }).strict(),
  browser_press_key: z.object({
    key: z.string().trim().min(1).max(256),
    viewId: viewIdSchema,
  }).strict(),
  browser_scroll: z.object({
    ref: refSchema.optional(),
    element: elementSchema,
    direction: z.enum(['up', 'down', 'left', 'right']).optional(),
    amount: z.number().finite().positive().max(100_000).optional(),
    deltaX: z.number().finite().min(-100_000).max(100_000).optional(),
    deltaY: z.number().finite().min(-100_000).max(100_000).optional(),
    viewId: viewIdSchema,
  }).strict(),
  browser_drag: z.object({
    sourceRef: refSchema,
    element: elementSchema,
    targetRef: refSchema.optional(),
    targetX: z.number().finite().optional(),
    targetY: z.number().finite().optional(),
    viewId: viewIdSchema,
  }).strict().superRefine((value, context) => {
    if (!value.targetRef && (value.targetX === undefined || value.targetY === undefined)) {
      context.addIssue({ code: 'custom', message: 'targetRef or both targetX and targetY are required' })
    }
  }),
  browser_get_bounding_box: z.object({
    ref: refSchema,
    element: elementSchema,
    viewId: viewIdSchema,
  }).strict(),
  browser_highlight: z.object({
    ref: refSchema,
    element: elementSchema,
    durationMs: z.number().finite().positive().max(5_000).optional(),
    viewId: viewIdSchema,
  }).strict(),
  browser_cdp: z.object({
    method: z.string().trim().min(1).max(500),
    params: z.record(z.string(), jsonValueSchema).optional(),
    viewId: viewIdSchema,
  }).strict(),
  browser_tabs: z.object({
    action: z.enum(['list', 'new', 'close', 'select']),
    index: z.number().int().nonnegative().optional(),
    viewId: viewIdSchema,
  }).strict().superRefine((value, context) => {
    if (value.action === 'select' && value.index === undefined) {
      context.addIssue({ code: 'custom', message: 'index is required when selecting a tab' })
    }
  }),
  browser_take_screenshot: z.object({
    viewId: viewIdSchema,
    fullPage: z.boolean().optional(),
  }).strict(),
} as const

export type BrowserToolName = keyof typeof browserToolArgsSchemas
export type BrowserToolArgs = z.infer<(typeof browserToolArgsSchemas)[BrowserToolName]>

const dedicatedTab = 'Target browser tab ID. If omitted, uses your dedicated tab (created on first use).'
const ref = { type: 'string', description: 'Element ref from browser_snapshot.' }
const element = { type: 'string', description: 'Human-readable description of the element.' }
const viewId = { type: 'string', description: dedicatedTab }

function definition(
  name: BrowserToolName,
  description: string,
  properties: Record<string, unknown>,
  required: string[] = [],
): ToolDefinition {
  return {
    type: 'function',
    function: {
      name,
      description,
      parameters: {
        type: 'object',
        properties,
        ...(required.length > 0 && { required }),
        additionalProperties: false,
      },
    },
  }
}

export const browserToolDefinitions: ToolDefinition[] = [
  definition('browser_navigate', 'Navigate the box browser to a URL. By default reuses your tab; set newTab: true to open in a new tab. Returns the resulting page state with a screenshot.', {
    url: { type: 'string', description: 'The URL to navigate to' }, viewId,
    newTab: { type: 'boolean', description: 'When true, creates a new tab before navigating instead of reusing an existing tab. Defaults to false.' },
  }, ['url']),
  definition('browser_snapshot', 'Capture a structured snapshot of the current page with [ref=eN] handles for interactive elements. This is the source of truth for page structure; refs are tied to the latest snapshot for that tab. Better than a screenshot for deciding what to click or type.', {
    viewId, interactive: { type: 'boolean', description: 'When true, only include interactive elements in the snapshot. Defaults to false.' },
    maxDepth: { type: 'number', description: 'Maximum depth for snapshot output. Defaults to 20.' },
    selector: { type: 'string', description: 'Optional CSS selector to scope the snapshot to a subtree.' },
  }),
  definition('browser_click', 'Click an element by ref from browser_snapshot. Scrolls the element into view first.', {
    ref, element: { type: 'string', description: 'Concise description of the element being clicked and why. Required when Auto-review is active.' },
    offsetX: { type: 'number', description: 'Optional x offset from the element center.' }, offsetY: { type: 'number', description: 'Optional y offset from the element center.' },
    doubleClick: { type: 'boolean', description: 'When true, double-click the element.' },
    button: { type: 'string', enum: ['left', 'right', 'middle'], description: 'Mouse button. Defaults to left.' },
    modifiers: { type: 'array', items: { type: 'string', enum: ['Control', 'Shift', 'Alt', 'Meta', 'ControlOrMeta'] }, description: 'Optional modifier keys.' },
    holdDurationMs: { type: 'number', description: 'Optional mouse hold duration before release.' }, viewId,
  }, ['ref']),
  definition('browser_mouse_click_xy', 'Click at viewport coordinates. Prefer browser_click with refs when possible.', {
    x: { type: 'number', description: 'Viewport x coordinate.' }, y: { type: 'number', description: 'Viewport y coordinate.' },
    element: { type: 'string', description: 'Concise description of the element being clicked and why. Required when Auto-review is active.' },
    button: { type: 'string', enum: ['left', 'right', 'middle'], description: 'Mouse button. Defaults to left.' }, viewId,
  }, ['x', 'y']),
  definition('browser_type', 'Type text into an input, textarea, or contenteditable element by ref.', {
    ref, text: { type: 'string', description: 'Text to type.' }, element,
    clear: { type: 'boolean', description: 'When true, clear existing text first.' }, submit: { type: 'boolean', description: 'When true, press Enter after typing.' },
    slowly: { type: 'boolean', description: 'When true, type character by character.' }, viewId,
  }, ['ref', 'text']),
  definition('browser_fill', 'Set the value of an input, textarea, or contenteditable element by ref.', {
    ref, value: { type: 'string', description: 'Value to set.' }, element, viewId,
  }, ['ref', 'value']),
  definition('browser_select_option', 'Select one or more options in a select element by ref.', {
    ref, values: { type: 'array', items: { type: 'string' }, description: 'Option values or labels to select.' }, element, viewId,
  }, ['ref', 'values']),
  definition('browser_press_key', 'Press a key in the browser page, for example Enter, Escape, Tab, ArrowDown, or a single character.', {
    key: { type: 'string', description: 'Key to press, for example Enter, Escape, Tab, ArrowDown, or a single character.' }, viewId,
  }, ['key']),
  definition('browser_scroll', 'Scroll the page or scroll an element into view (pass its ref).', {
    ref: { type: 'string', description: 'Optional element ref from browser_snapshot to scroll into view.' }, element,
    direction: { type: 'string', enum: ['up', 'down', 'left', 'right'], description: 'Scroll direction. Defaults to down.' }, amount: { type: 'number', description: 'Scroll amount in pixels. Defaults to 300.' },
    deltaX: { type: 'number', description: 'Explicit horizontal scroll delta.' }, deltaY: { type: 'number', description: 'Explicit vertical scroll delta.' }, viewId,
  }),
  definition('browser_drag', 'Drag an element by ref to another ref or viewport coordinates.', {
    sourceRef: { type: 'string', description: 'Source element ref from browser_snapshot.' },
    element: { type: 'string', description: 'Concise description of what is being dragged where, and why. Required when Auto-review is active.' },
    targetRef: { type: 'string', description: 'Optional target element ref from browser_snapshot.' }, targetX: { type: 'number', description: 'Optional target viewport x coordinate.' },
    targetY: { type: 'number', description: 'Optional target viewport y coordinate.' }, viewId,
  }, ['sourceRef']),
  definition('browser_get_bounding_box', 'Get the viewport bounding box for an element ref.', { ref, element, viewId }, ['ref']),
  definition('browser_highlight', 'Highlight an element by ref in the browser page for visual grounding. The returned screenshot shows the highlight.', {
    ref, element, durationMs: { type: 'number', description: 'Highlight duration in milliseconds. Defaults to 2000.' }, viewId,
  }, ['ref']),
  definition('browser_cdp', 'Send a Chrome DevTools Protocol command to the target browser tab. Do not use CDP Input.* methods; use dedicated browser tools for clicks, text input, key presses, scrolling, and drag-and-drop. Browser-wide, storage, cookie, cache, permission, and target-management commands are denied.', {
    method: { type: 'string', description: 'CDP method name, for example Runtime.evaluate, DOM.getDocument, or Performance.getMetrics.' },
    params: { type: 'object', properties: {}, additionalProperties: true, description: 'CDP params object. Omit or pass {} when the command takes no params.' }, viewId,
  }, ['method']),
  definition('browser_tabs', 'List, create, close, or select a browser tab.', {
    action: { type: 'string', enum: ['list', 'new', 'close', 'select'], description: 'Operation to perform' },
    index: { type: 'number', description: 'Tab index. Required for "select". Optional for "close" (defaults to current tab).' }, viewId,
  }, ['action']),
  definition('browser_take_screenshot', 'Take a screenshot of the current page. Usually redundant: every browser action already returns one. Use fullPage for the full scrollable page.', {
    viewId, fullPage: { type: 'boolean', description: 'When true, captures the full scrollable page instead of the visible viewport.' },
  }),
]

export function browserOperationRequest(
  name: BrowserToolName,
  args: BrowserToolArgs,
  trusted: { display: number; cdpPort: number; viewId: string; screenshotPath: string },
): BrowserOperationRequest {
  const modelArgs = args as Record<string, unknown>
  const skipScreenshot = name === 'browser_tabs' || name === 'browser_get_bounding_box'
  const common = {
    display: trusted.display,
    cdpPort: trusted.cdpPort,
    viewId: typeof modelArgs.viewId === 'string' ? modelArgs.viewId : trusted.viewId,
    ...(!skipScreenshot && { screenshotPath: trusted.screenshotPath }),
  }
  const operation = name === 'browser_take_screenshot'
    ? 'screenshot'
    : name.slice('browser_'.length)
  const driverArgs = { ...modelArgs }
  if (name === 'browser_mouse_click_xy' || name === 'browser_drag') delete driverArgs.element
  if (name === 'browser_click' && Array.isArray(driverArgs.modifiers)) {
    driverArgs.modifiers = driverArgs.modifiers.map((modifier) =>
      modifier === 'ControlOrMeta' ? 'Control' : modifier)
  }
  return { ...driverArgs, ...common, op: operation } as BrowserOperationRequest
}

export async function executeBrowserTool(
  call: ModelToolCall,
  args: unknown,
  context?: ToolTurnContext,
) {
  if (!context?.browser) {
    return { ok: false, status: 'browser_unavailable', summary: `${call.function.name} is unavailable` }
  }
  return context.browser.execute(call.id, call.function.name, args)
}
