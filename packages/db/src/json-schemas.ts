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

export const waitingStateSchema = z.object({
  version: z.literal(1),
  prompt: z.string().min(1),
  options: z.array(
    z.object({
      id: z.string().min(1),
      label: z.string().min(1),
      style: z.enum(['primary', 'danger']).optional(),
    }),
  ),
  allowCustom: z.boolean().default(false),
  dismissOnMoveOn: z.boolean().default(false),
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
      options: z.array(
        z.object({
          id: z.string().min(1),
          label: z.string().min(1),
          style: z.enum(['primary', 'danger']).optional(),
        }),
      ),
      allowCustom: z.boolean().default(false),
      dismissOnMoveOn: z.boolean().default(false),
    })
    .optional(),
  alt: z.string().optional(),
})

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
export type SendMessagePayload = z.infer<typeof sendMessagePayloadSchema>
export type DirectAgentMessagePayload = z.infer<typeof directAgentMessagePayloadSchema>
export type DirectAgentMessageContext = z.infer<typeof directAgentMessageContextSchema>
export type ApiKeyCredentials = z.infer<typeof apiKeyCredentialsSchema>
export type OauthCredentials = z.infer<typeof oauthCredentialsSchema>
export type McpCredentials = ApiKeyCredentials | OauthCredentials

export function parseMcpCredentials(authType: 'api_key' | 'oauth', value: unknown) {
  return authType === 'api_key'
    ? apiKeyCredentialsSchema.parse(value)
    : oauthCredentialsSchema.parse(value)
}
