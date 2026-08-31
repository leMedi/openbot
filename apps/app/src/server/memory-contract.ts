import * as z from 'zod'

type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue }

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
const memoryMetadata = z.object({ version: z.literal(1) }).catchall(jsonValueSchema)
const memoryKind = z.enum(['profile', 'log', 'note'])
const memoryFields = {
  kind: memoryKind,
  content: z.string().trim().min(1).max(20_000),
  authoredByAgentId: z.string().min(1).nullable().optional(),
  metadata: memoryMetadata.optional(),
}

export const memoryItemCreateInput = z.discriminatedUnion('scope', [
  z.object({
    ...memoryFields,
    scope: z.literal('user'),
    subjectAgentId: z.never().optional(),
  }),
  z.object({
    ...memoryFields,
    scope: z.literal('agent'),
    subjectAgentId: z.string().min(1),
  }),
])

export const memoryListInput = z.discriminatedUnion('scope', [
  z.object({ scope: z.literal('user') }),
  z.object({
    scope: z.literal('agent'),
    subjectAgentId: z.string().min(1),
  }),
])

export const memoryItemSelector = z.discriminatedUnion('scope', [
  z.object({ id: z.string().min(1), scope: z.literal('user') }),
  z.object({
    id: z.string().min(1),
    scope: z.literal('agent'),
    subjectAgentId: z.string().min(1),
  }),
])

export const memoryUpdateInput = z.object({
  selector: memoryItemSelector,
  patch: z
    .object({
      kind: memoryKind.optional(),
      content: memoryFields.content.optional(),
      metadata: memoryMetadata.optional(),
    })
    .refine((patch) => Object.keys(patch).length > 0),
})
