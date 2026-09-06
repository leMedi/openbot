export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue }

export type BrowserOperation =
  | 'navigate'
  | 'snapshot'
  | 'click'
  | 'mouse_click_xy'
  | 'type'
  | 'fill'
  | 'select_option'
  | 'press_key'
  | 'scroll'
  | 'tabs'
  | 'screenshot'
  | 'drag'
  | 'get_bounding_box'
  | 'highlight'
  | 'cdp'

export type BrowserRequestBase = {
  display: number
  cdpPort: number
  viewId?: string
  screenshotPath?: string
}

export type NavigateRequest = BrowserRequestBase & {
  op: 'navigate'
  url: string
  newTab?: boolean
}

export type SnapshotRequest = BrowserRequestBase & {
  op: 'snapshot'
  interactive?: boolean
  maxDepth?: number
  selector?: string
}

export type ClickRequest = BrowserRequestBase & {
  op: 'click'
  ref: string
  element?: string
  button?: 'left' | 'right' | 'middle'
  modifiers?: Array<'Alt' | 'Control' | 'Meta' | 'Shift'>
  holdDurationMs?: number
  doubleClick?: boolean
  offsetX?: number
  offsetY?: number
}

export type MouseClickRequest = BrowserRequestBase & {
  op: 'mouse_click_xy'
  x: number
  y: number
  button?: 'left' | 'right' | 'middle'
}

export type TypeRequest = BrowserRequestBase & {
  op: 'type'
  ref: string
  text: string
  element?: string
  clear?: boolean
  slowly?: boolean
  submit?: boolean
}

export type FillRequest = BrowserRequestBase & {
  op: 'fill'
  ref: string
  value: string
  element?: string
}

export type SelectOptionRequest = BrowserRequestBase & {
  op: 'select_option'
  ref: string
  values: string[]
  element?: string
}

export type PressKeyRequest = BrowserRequestBase & {
  op: 'press_key'
  key: string
}

export type ScrollRequest = BrowserRequestBase & {
  op: 'scroll'
  ref?: string
  element?: string
  amount?: number
  deltaX?: number
  deltaY?: number
  direction?: 'up' | 'down' | 'left' | 'right'
}

export type TabsRequest = BrowserRequestBase & {
  op: 'tabs'
  action: 'list' | 'new' | 'select' | 'close'
  index?: number
}

export type ScreenshotRequest = BrowserRequestBase & {
  op: 'screenshot'
  fullPage?: boolean
}

export type DragRequest = BrowserRequestBase & {
  op: 'drag'
  sourceRef: string
  targetRef?: string
  targetX?: number
  targetY?: number
}

export type BoundingBoxRequest = BrowserRequestBase & {
  op: 'get_bounding_box'
  ref: string
  element?: string
}

export type HighlightRequest = BrowserRequestBase & {
  op: 'highlight'
  ref: string
  element?: string
  durationMs?: number
}

export type CdpRequest = BrowserRequestBase & {
  op: 'cdp'
  method: string
  params?: Record<string, JsonValue>
}

export type BrowserOperationRequest =
  | NavigateRequest
  | SnapshotRequest
  | ClickRequest
  | MouseClickRequest
  | TypeRequest
  | FillRequest
  | SelectOptionRequest
  | PressKeyRequest
  | ScrollRequest
  | TabsRequest
  | ScreenshotRequest
  | DragRequest
  | BoundingBoxRequest
  | HighlightRequest
  | CdpRequest

export type BrowserOperationSuccess = {
  ok: true
  summary: string
  data?: string
  viewId?: string
  url?: string
  title?: string
  /** True when screenshotPath was successfully written. */
  screenshot?: true
}

export type BrowserOperationFailure = {
  ok: false
  error: string
  code?: 'invalid_request' | 'timeout' | 'cancelled' | 'driver_failure'
}

export type BrowserOperationResult = BrowserOperationSuccess | BrowserOperationFailure

export type BrowserDriverOptions = {
  /** Cancellation is combined with the driver's mandatory 90-second watchdog. */
  signal?: AbortSignal
  /**
   * Trusted host configuration. This path is intentionally absent from every
   * operation schema so model/tool input cannot select a credential file.
   */
  sharedCookiesPath?: string
}

export type JsonSchema = {
  type: 'object'
  additionalProperties: boolean
  properties: Record<string, unknown>
  required?: readonly string[]
}

const ref = { type: 'string', minLength: 1 }
const viewId = { type: 'string', minLength: 1 }

export const browserOperationSchemas = {
  navigate: {
    type: 'object',
    additionalProperties: false,
    properties: { url: { type: 'string', minLength: 1 }, newTab: { type: 'boolean' }, viewId },
    required: ['url'],
  },
  snapshot: {
    type: 'object',
    additionalProperties: false,
    properties: {
      interactive: { type: 'boolean' },
      maxDepth: { type: 'integer', minimum: 0, maximum: 100 },
      selector: { type: 'string', minLength: 1 },
      viewId,
    },
  },
  click: {
    type: 'object',
    additionalProperties: false,
    properties: {
      ref,
      element: { type: 'string' },
      button: { enum: ['left', 'right', 'middle'] },
      modifiers: { type: 'array', items: { enum: ['Alt', 'Control', 'Meta', 'Shift'] } },
      holdDurationMs: { type: 'number', minimum: 0, maximum: 5000 },
      doubleClick: { type: 'boolean' },
      offsetX: { type: 'number' },
      offsetY: { type: 'number' },
      viewId,
    },
    required: ['ref'],
  },
  mouse_click_xy: {
    type: 'object',
    additionalProperties: false,
    properties: {
      x: { type: 'number' },
      y: { type: 'number' },
      button: { enum: ['left', 'right', 'middle'] },
      viewId,
    },
    required: ['x', 'y'],
  },
  type: {
    type: 'object',
    additionalProperties: false,
    properties: {
      ref,
      text: { type: 'string' },
      element: { type: 'string' },
      clear: { type: 'boolean' },
      slowly: { type: 'boolean' },
      submit: { type: 'boolean' },
      viewId,
    },
    required: ['ref', 'text'],
  },
  fill: {
    type: 'object',
    additionalProperties: false,
    properties: { ref, value: { type: 'string' }, element: { type: 'string' }, viewId },
    required: ['ref', 'value'],
  },
  select_option: {
    type: 'object',
    additionalProperties: false,
    properties: {
      ref,
      values: { type: 'array', items: { type: 'string' } },
      element: { type: 'string' },
      viewId,
    },
    required: ['ref', 'values'],
  },
  press_key: {
    type: 'object',
    additionalProperties: false,
    properties: { key: { type: 'string', minLength: 1 }, viewId },
    required: ['key'],
  },
  scroll: {
    type: 'object',
    additionalProperties: false,
    properties: {
      ref,
      element: { type: 'string' },
      amount: { type: 'number', exclusiveMinimum: 0 },
      deltaX: { type: 'number' },
      deltaY: { type: 'number' },
      direction: { enum: ['up', 'down', 'left', 'right'] },
      viewId,
    },
  },
  tabs: {
    type: 'object',
    additionalProperties: false,
    properties: {
      action: { enum: ['list', 'new', 'select', 'close'] },
      index: { type: 'integer', minimum: 0 },
      viewId,
    },
    required: ['action'],
  },
  screenshot: {
    type: 'object',
    additionalProperties: false,
    properties: { fullPage: { type: 'boolean' }, viewId },
  },
  drag: {
    type: 'object',
    additionalProperties: false,
    properties: {
      sourceRef: ref,
      targetRef: ref,
      targetX: { type: 'number' },
      targetY: { type: 'number' },
      viewId,
    },
    required: ['sourceRef'],
  },
  get_bounding_box: {
    type: 'object',
    additionalProperties: false,
    properties: { ref, element: { type: 'string' }, viewId },
    required: ['ref'],
  },
  highlight: {
    type: 'object',
    additionalProperties: false,
    properties: {
      ref,
      element: { type: 'string' },
      durationMs: { type: 'number', exclusiveMinimum: 0, maximum: 5000 },
      viewId,
    },
    required: ['ref'],
  },
  cdp: {
    type: 'object',
    additionalProperties: false,
    properties: { method: { type: 'string', minLength: 1 }, params: { type: 'object' }, viewId },
    required: ['method'],
  },
} as const satisfies Record<BrowserOperation, JsonSchema>

export const browserOperations = Object.keys(browserOperationSchemas) as BrowserOperation[]
