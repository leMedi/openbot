import * as z from 'zod'

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue }

export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number(),
    z.string(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
)

export const versionedObjectSchema = z
  .object({ version: z.literal(1) })
  .catchall(jsonValueSchema)

export const computerUseWorkerContextSchema = z.object({
  version: z.literal(1),
  type: z.literal('computer-use-worker'),
  task: z.string().trim().min(1).max(20_000),
  title: z.string().trim().min(1).max(120),
  parentToolCallId: z.string().min(1).max(500),
})

export const computerUseCompletionWakeSchema = z.object({
  version: z.literal(1),
  type: z.literal('computer-use-completed'),
  childTurnId: z.string().min(1),
  parentTurnId: z.string().min(1),
  title: z.string().trim().min(1).max(120),
  status: z.enum(['succeeded', 'failed']),
  summary: z.string().trim().min(1).max(20_000),
})

export const browserUseWorkerContextSchema = z.object({
  version: z.literal(1),
  type: z.literal('browser-use-worker'),
  task: z.string().trim().min(1).max(20_000),
  title: z.string().trim().min(1).max(120),
  parentToolCallId: z.string().min(1).max(500),
})

export const browserUseCompletionWakeSchema = z.object({
  version: z.literal(1),
  type: z.literal('browser-use-completed'),
  childTurnId: z.string().min(1),
  parentTurnId: z.string().min(1),
  title: z.string().trim().min(1).max(120),
  status: z.enum(['succeeded', 'failed']),
  summary: z.string().trim().min(1).max(20_000),
})

export const generalSubagentContextSchema = z.object({
  version: z.literal(1),
  type: z.literal('general-subagent'),
  task: z.string().trim().min(1).max(20_000),
  title: z.string().trim().min(1).max(120),
  parentToolCallId: z.string().min(1).max(500),
})

export const generalSubagentCompletionWakeSchema = z.object({
  version: z.literal(1),
  type: z.literal('general-subagent-completed'),
  childTurnId: z.string().min(1),
  parentTurnId: z.string().min(1),
  title: z.string().trim().min(1).max(120),
  status: z.enum(['succeeded', 'failed']),
  summary: z.string().trim().min(1).max(20_000),
})

export const subagentControlPayloadSchema = z.object({
  version: z.literal(1),
  event: z.literal('subagent-control'),
  controlId: z.string().min(1),
  subagentTurnId: z.string().min(1),
  action: z.literal('steer'),
  stage: z.enum(['requested', 'applied']),
  toolCallId: z.string().min(1).max(500),
  message: z.string().trim().min(1).max(20_000),
})

export const subagentSummarySchema = z.object({
  id: z.string().min(1),
  agentId: z.string().min(1).nullable(),
  type: z.enum(['executor', 'computerUse', 'browserUse']),
  title: z.string().min(1),
  status: z.enum(['queued', 'running', 'waiting', 'succeeded', 'failed', 'cancelled']),
  startedAt: z.number().int().nonnegative().nullable(),
  elapsedMs: z.number().int().nonnegative().nullable(),
  attemptCount: z.number().int().nonnegative(),
  toolCallCount: z.number().int().nonnegative(),
  recentActivity: z.array(z.string()),
})

export const groupMembersSchema = z.object({
  version: z.literal(1),
  members: z.array(
    z.discriminatedUnion('type', [
      z.object({
        type: z.literal('agent'),
        agentId: z.string().min(1),
      }),
    ]),
  ),
})

export const attachmentsSchema = z.object({
  version: z.literal(1),
  items: z.array(
    z.object({
      fileId: z.string().min(1),
      position: z.number().int().nonnegative(),
      metadata: z.record(z.string(), jsonValueSchema),
    }),
  ),
})

const reactionSchema = z
  .object({
    reaction: z.string().min(1),
    actorAgentId: z.string().min(1).nullable(),
    actorExternalId: z.string().min(1).nullable(),
    createdAt: z.number().int().nonnegative(),
  })
  .refine(
    ({ actorAgentId, actorExternalId }) =>
      !(actorAgentId && actorExternalId),
    'A reaction cannot have both a local agent and an external actor',
  )

export const reactionsSchema = z
  .object({
    version: z.literal(1),
    items: z.array(reactionSchema),
  })
  .superRefine(({ items }, context) => {
    const seen = new Set<string>()

    for (const [index, item] of items.entries()) {
      const actor = item.actorAgentId
        ? `agent:${item.actorAgentId}`
        : item.actorExternalId
          ? `external:${item.actorExternalId}`
          : 'user'
      const key = `${actor}:${item.reaction}`

      if (seen.has(key)) {
        context.addIssue({
          code: 'custom',
          message: 'An actor can apply a reaction only once',
          path: ['items', index],
        })
      }
      seen.add(key)
    }
  })

/** OpenAI-compatible tool call emitted by the model. */
export const modelToolCallSchema = z.object({
  id: z.string().min(1),
  type: z.literal('function'),
  function: z.object({
    name: z.string().min(1),
    arguments: z.string(),
  }),
})

export const effectiveToolsSchema = z.object({
  version: z.literal(1),
  tools: z.array(z.string().min(1)),
})

const widgetOptionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  description: z.string().min(1).optional(),
  style: z.enum(['primary', 'danger']).optional(),
})

/** Plugin identity carried by widgets that ask to enable a plugin. */
const widgetPluginSchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
})

export const waitingStateSchema = z.object({
  version: z.literal(1),
  interactionKind: z.enum(['question', 'approval']).default('question'),
  prompt: z.string().min(1),
  helpText: z.string().min(1).optional(),
  options: z.array(widgetOptionSchema),
  allowCustom: z.boolean().default(false),
  dismissOnMoveOn: z.boolean().default(false),
  plugin: widgetPluginSchema.optional(),
  originatingToolCall: z.object({
    id: z.string().min(1),
    name: z.string().min(1),
  }),
  resumeData: jsonValueSchema,
  response: z
    .object({
      optionId: z.string().min(1).nullable(),
      text: z.string().min(1),
      dismissed: z.boolean().default(false),
      requestId: z.string().min(1),
      idempotencyKey: z.string().min(1),
      respondedAt: z.number().int().nonnegative(),
    })
    .nullable(),
})

// Payload persisted on a transcript row delivered by the SendMessage tool.
// `deliveryKind` marks the row for recovery/replay filters; `type` drives
// client rendering. Widget options carry server-generated ids.
export const sendMessagePayloadSchema = z.object({
  version: z.literal(1),
  deliveryKind: z.literal('send-message'),
  type: z.enum(['text', 'widget', 'attachment']),
  toolCallId: z.string().min(1),
  widget: z
    .object({
      prompt: z.string().min(1),
      helpText: z.string().min(1).optional(),
      interactionKind: z.enum(['question', 'approval']).default('question'),
      options: z.array(widgetOptionSchema),
      allowCustom: z.boolean().default(false),
      dismissOnMoveOn: z.boolean().default(false),
      plugin: widgetPluginSchema.optional(),
    })
    .optional(),
  alt: z.string().optional(),
})

const computerDisplaySchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  sessionId: z.string().min(1),
})

const computerCursorSchema = z.object({
  x: z.number().int().nonnegative(),
  y: z.number().int().nonnegative(),
})

const computerScreenshotSchema = z.object({
  fileId: z.string().min(1),
  url: z.string().min(1),
  mediaType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  stateId: z.string().min(1),
  cursor: computerCursorSchema.optional(),
})

export const browserToolNameSchema = z.enum([
  'browser_navigate',
  'browser_snapshot',
  'browser_click',
  'browser_mouse_click_xy',
  'browser_type',
  'browser_fill',
  'browser_select_option',
  'browser_press_key',
  'browser_scroll',
  'browser_drag',
  'browser_get_bounding_box',
  'browser_highlight',
  'browser_cdp',
  'browser_tabs',
  'browser_take_screenshot',
])

const browserScreenshotSchema = z.object({
  fileId: z.string().min(1),
  url: z.string().min(1),
  mediaType: z.literal('image/png'),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
})

export const browserOutcomeSchema = z.enum([
  'success',
  'invalid_input',
  'approval_required',
  'review_blocked',
  'stale_browser',
  'browser_unavailable',
  'browser_busy',
  'timeout',
  'cancelled',
  'driver_failure',
  'unknown_outcome',
])

/** Durable, client-safe result/audit projections for browser automation. */
export const browserUsePayloadSchema = z.discriminatedUnion('event', [
  z.object({
    version: z.literal(1),
    event: z.literal('browser-use'),
    toolCallId: z.string().min(1),
    name: browserToolNameSchema,
    preview: z.string(),
    status: z.enum(['success', 'failed']),
    outcome: browserOutcomeSchema,
    detail: z.string(),
    data: z.string().optional(),
    viewId: z.string().min(1).optional(),
    url: z.string().optional(),
    title: z.string().optional(),
    fingerprint: z.string().min(1).optional(),
    stateId: z.string().min(1).optional(),
    screenshot: browserScreenshotSchema.optional(),
  }),
  z.object({
    version: z.literal(1),
    event: z.literal('browser-use-progress'),
    toolCallId: z.string().min(1),
    name: browserToolNameSchema,
    preview: z.string().min(1),
    status: z.literal('pending'),
    fingerprint: z.string().min(1),
  }),
  z.object({
    version: z.literal(1),
    event: z.literal('browser-use-audit'),
    toolCallId: z.string().min(1),
    name: browserToolNameSchema,
    fingerprint: z.string().min(1),
    stage: z.enum(['review_decision', 'execution_started']),
    decision: z.enum(['allowed', 'blocked', 'approval_required', 'approved']).optional(),
    summary: z.string().min(1),
  }),
])

export const computerOutcomeSchema = z.enum([
  'success',
  'invalid_input',
  'approval_required',
  'review_blocked',
  'stale_desktop',
  'desktop_unavailable',
  'desktop_busy',
  'timeout',
  'cancelled',
  'driver_failure',
])

/** Durable, client-safe result/audit projections for server-side Computer Use. */
export const computerUsePayloadSchema = z.discriminatedUnion('event', [
  z.object({
    version: z.literal(1),
    event: z.literal('computer-use'),
    toolCallId: z.string().min(1),
    name: z.enum(['Screenshot', 'Computer']),
    preview: z.string(),
    status: z.enum(['success', 'failed']),
    outcome: computerOutcomeSchema,
    detail: z.string(),
    display: computerDisplaySchema.optional(),
    cursor: computerCursorSchema.optional(),
    fingerprint: z.string().min(1).optional(),
    stateId: z.string().min(1).optional(),
    screenshot: computerScreenshotSchema.optional(),
  }),
  z.object({
    version: z.literal(1),
    event: z.literal('computer-use-progress'),
    toolCallId: z.string().min(1),
    name: z.literal('Computer'),
    preview: z.string().min(1),
    status: z.literal('pending'),
    fingerprint: z.string().min(1),
  }),
  z.object({
    version: z.literal(1),
    event: z.literal('computer-use-audit'),
    toolCallId: z.string().min(1),
    fingerprint: z.string().min(1),
    stage: z.enum(['review_decision', 'execution_started']),
    decision: z.enum(['allowed', 'blocked', 'approval_required', 'approved']).optional(),
    actions: z.array(z.string().min(1)).min(1).max(10),
    summary: z.string().min(1),
  }),
])

export const directAgentMessagePayloadSchema = z.object({
  version: z.literal(1),
  event: z.literal('direct-agent-message'),
  deliveryId: z.string().min(1),
  senderAgentId: z.string().min(1),
  senderAgentName: z.string().min(1),
  recipientAgentId: z.string().min(1),
  recipientAgentName: z.string().min(1),
})

export const directAgentMessageContextSchema = z.object({
  version: z.literal(1),
  type: z.literal('direct-agent-message'),
  deliveryId: z.string().min(1),
  senderAgentId: z.string().min(1),
  senderAgentName: z.string().min(1),
  recipientAgentId: z.string().min(1),
  content: z.string().min(1).max(20_000),
})

export const routineWakeSchema = z.object({
  version: z.literal(1),
  type: z.literal('routine'),
  routineId: z.string().min(1),
  routineRevision: z.number().int().positive(),
  name: z.string().trim().min(1).max(120),
  instruction: z.string().trim().min(1).max(20_000),
  cronExpression: z.string().trim().min(1).max(100),
  timezone: z.string().trim().min(1).max(100),
  enabled: z.boolean(),
  nextRunAt: z.number().int().nonnegative().nullable(),
  scheduledFor: z.number().int().nonnegative(),
})

const routineCreateOperationSchema = z.object({
  action: z.literal('create'),
  routineId: z.string().min(1),
  name: z.string().trim().min(1).max(120),
  instruction: z.string().trim().min(1).max(20_000),
  cronExpression: z.string().trim().min(1).max(100),
  timezone: z.string().trim().min(1).max(100),
  enabled: z.boolean(),
})

const routineUpdateOperationSchema = z.object({
  action: z.literal('update'),
  routineId: z.string().min(1),
  expectedRevision: z.number().int().positive(),
  name: z.string().trim().min(1).max(120).optional(),
  instruction: z.string().trim().min(1).max(20_000).optional(),
  cronExpression: z.string().trim().min(1).max(100).optional(),
  timezone: z.string().trim().min(1).max(100).optional(),
})

const routineIdOperationSchema = z.object({
  action: z.enum(['pause', 'resume', 'delete']),
  routineId: z.string().min(1),
  expectedRevision: z.number().int().positive(),
})

export const routineOperationSchema = z.discriminatedUnion('action', [
  routineCreateOperationSchema,
  routineUpdateOperationSchema,
  routineIdOperationSchema,
])

export const routineApprovalResumeSchema = z.object({
  version: z.literal(1),
  type: z.literal('routine-approval'),
  operation: routineOperationSchema,
})

export const apiKeyCredentialsSchema = z.object({
  version: z.literal(1),
  apiKey: z.string().min(1),
})

const oauthCredentialValueSchema = z
  .string()
  .min(1)
  .max(20_000)
  .refine((value) => !/[\0\r\n]/.test(value), 'OAuth credential contains invalid characters')

const oauthUrlSchema = z.url().refine((value) => {
  const url = new URL(value)
  return (
    (url.protocol === 'http:' || url.protocol === 'https:') &&
    !url.username &&
    !url.password
  )
}, 'OAuth URL must be HTTP(S) and cannot contain credentials')

export const oauthCredentialsSchema = z.object({
  version: z.literal(1),
  accessToken: oauthCredentialValueSchema,
  refreshToken: oauthCredentialValueSchema.nullable(),
  tokenType: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/),
  scope: z.array(z.string().min(1).max(1_000)),
  expiresAt: z.number().int().nonnegative().nullable(),
  clientId: oauthCredentialValueSchema,
  clientSecret: oauthCredentialValueSchema.nullable(),
  tokenEndpointAuthMethod: z.string().min(1).nullable(),
  resourceServerUrl: oauthUrlSchema,
  authorizationServerUrl: oauthUrlSchema,
  tokenEndpoint: oauthUrlSchema,
  resource: oauthUrlSchema.nullable(),
  issuer: oauthUrlSchema,
})

/** OpenAI-compatible function tool declaration, sent verbatim on the wire. */
export type ToolDefinition = {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

export type VersionedObject = z.infer<typeof versionedObjectSchema>
export type ModelToolCall = z.infer<typeof modelToolCallSchema>
export type GroupMembers = z.infer<typeof groupMembersSchema>
export type Attachments = z.infer<typeof attachmentsSchema>
export type Reactions = z.infer<typeof reactionsSchema>
export type EffectiveTools = z.infer<typeof effectiveToolsSchema>
export type WaitingState = z.infer<typeof waitingStateSchema>
export type ComputerUseWorkerContext = z.infer<typeof computerUseWorkerContextSchema>
export type ComputerUseCompletionWake = z.infer<typeof computerUseCompletionWakeSchema>
export type BrowserUseWorkerContext = z.infer<typeof browserUseWorkerContextSchema>
export type BrowserUseCompletionWake = z.infer<typeof browserUseCompletionWakeSchema>
export type GeneralSubagentContext = z.infer<typeof generalSubagentContextSchema>
export type GeneralSubagentCompletionWake = z.infer<typeof generalSubagentCompletionWakeSchema>
export type SubagentControlPayload = z.infer<typeof subagentControlPayloadSchema>
export type SubagentSummary = z.infer<typeof subagentSummarySchema>
export type BrowserUsePayload = z.infer<typeof browserUsePayloadSchema>
export type SendMessagePayload = z.infer<typeof sendMessagePayloadSchema>
export type DirectAgentMessagePayload = z.infer<typeof directAgentMessagePayloadSchema>
export type DirectAgentMessageContext = z.infer<typeof directAgentMessageContextSchema>
export type RoutineWake = z.infer<typeof routineWakeSchema>
export type RoutineOperation = z.infer<typeof routineOperationSchema>
export type RoutineApprovalResume = z.infer<typeof routineApprovalResumeSchema>
export type ApiKeyCredentials = z.infer<typeof apiKeyCredentialsSchema>
export type OauthCredentials = z.infer<typeof oauthCredentialsSchema>
export type McpCredentials = ApiKeyCredentials | OauthCredentials

export function parseMcpCredentials(authType: 'api_key' | 'oauth', value: unknown) {
  return authType === 'api_key'
    ? apiKeyCredentialsSchema.parse(value)
    : oauthCredentialsSchema.parse(value)
}
