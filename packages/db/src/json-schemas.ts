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

export const effectiveToolsSchema = z.object({
  version: z.literal(1),
  tools: z.array(z.string().min(1)),
})

export const apiKeyCredentialsSchema = z.object({
  version: z.literal(1),
  apiKey: z.string().min(1),
})

export const oauthCredentialsSchema = z.object({
  version: z.literal(1),
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1).nullable(),
  tokenType: z.string().min(1),
  scope: z.array(z.string()),
  expiresAt: z.number().int().nonnegative().nullable(),
})

export type VersionedObject = z.infer<typeof versionedObjectSchema>
export type GroupMembers = z.infer<typeof groupMembersSchema>
export type Attachments = z.infer<typeof attachmentsSchema>
export type Reactions = z.infer<typeof reactionsSchema>
export type EffectiveTools = z.infer<typeof effectiveToolsSchema>
export type ApiKeyCredentials = z.infer<typeof apiKeyCredentialsSchema>
export type OauthCredentials = z.infer<typeof oauthCredentialsSchema>
export type McpCredentials = ApiKeyCredentials | OauthCredentials

export function parseMcpCredentials(authType: 'api_key' | 'oauth', value: unknown) {
  return authType === 'api_key'
    ? apiKeyCredentialsSchema.parse(value)
    : oauthCredentialsSchema.parse(value)
}
