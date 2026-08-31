import { and, asc, eq, or } from 'drizzle-orm'
import * as z from 'zod'
import { db } from './client'
import { createId } from './ids'
import { versionedObjectSchema, type VersionedObject } from './json-schemas'
import * as schema from './schema'

export const memoryKindSchema = z.enum(['profile', 'log', 'note'])

const memoryFields = {
  kind: memoryKindSchema,
  content: z.string().trim().min(1).max(20_000),
  authoredByAgentId: z.string().min(1).nullable().optional(),
  metadata: versionedObjectSchema.optional(),
}

export const memoryItemCreateSchema = z.discriminatedUnion('scope', [
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

export const memoryItemUpdateSchema = z
  .object({
    kind: memoryKindSchema.optional(),
    content: memoryFields.content.optional(),
    metadata: versionedObjectSchema.optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, 'A memory update is required')

export type MemoryKind = z.infer<typeof memoryKindSchema>
export type MemoryItemCreateInput = z.input<typeof memoryItemCreateSchema>
export type MemoryItemUpdate = z.input<typeof memoryItemUpdateSchema>
export type MemoryListFilter =
  | { scope: 'user' }
  | { scope: 'agent'; subjectAgentId: string }
export type MemoryItemSelector = MemoryListFilter & { id: string }

function scopeCondition(filter: MemoryListFilter) {
  return filter.scope === 'user'
    ? eq(schema.memoryItems.scope, 'user')
    : and(
        eq(schema.memoryItems.scope, 'agent'),
        eq(schema.memoryItems.subjectAgentId, filter.subjectAgentId),
      )
}

export async function createMemoryItem(input: MemoryItemCreateInput) {
  const validated = memoryItemCreateSchema.parse(input)
  const now = Date.now()
  const [created] = await db
    .insert(schema.memoryItems)
    .values({
      id: createId('mem'),
      scope: validated.scope,
      subjectAgentId:
        validated.scope === 'agent' ? validated.subjectAgentId : null,
      authoredByAgentId: validated.authoredByAgentId ?? null,
      kind: validated.kind,
      content: validated.content,
      metadataJson: validated.metadata ?? { version: 1 },
      createdAt: now,
      updatedAt: now,
    })
    .returning()
  return created
}

export async function getMemoryItem(selector: MemoryItemSelector) {
  const [item] = await db
    .select()
    .from(schema.memoryItems)
    .where(and(eq(schema.memoryItems.id, selector.id), scopeCondition(selector)))
    .limit(1)
  return item
}

export function listMemoryItems(filter: MemoryListFilter) {
  return db
    .select()
    .from(schema.memoryItems)
    .where(scopeCondition(filter))
    .orderBy(asc(schema.memoryItems.createdAt), asc(schema.memoryItems.id))
}

/** Shared-user memory plus memory isolated to the executing agent. */
export async function listPromptMemoryForAgent(agentId: string) {
  const items = await db
    .select()
    .from(schema.memoryItems)
    .where(
      or(
        eq(schema.memoryItems.scope, 'user'),
        and(
          eq(schema.memoryItems.scope, 'agent'),
          eq(schema.memoryItems.subjectAgentId, agentId),
        ),
      ),
    )
    .orderBy(asc(schema.memoryItems.createdAt), asc(schema.memoryItems.id))

  // Shared facts precede private facts while preserving stable item order.
  return [
    ...items.filter((item) => item.scope === 'user'),
    ...items.filter((item) => item.scope === 'agent'),
  ]
}

export async function updateMemoryItem(
  selector: MemoryItemSelector,
  patch: MemoryItemUpdate,
) {
  const validated = memoryItemUpdateSchema.parse(patch)
  const values: {
    kind?: MemoryKind
    content?: string
    metadataJson?: VersionedObject
    updatedAt: number
  } = { updatedAt: Date.now() }
  if (validated.kind !== undefined) values.kind = validated.kind
  if (validated.content !== undefined) values.content = validated.content
  if (validated.metadata !== undefined) values.metadataJson = validated.metadata

  const [updated] = await db
    .update(schema.memoryItems)
    .set(values)
    .where(and(eq(schema.memoryItems.id, selector.id), scopeCondition(selector)))
    .returning()
  return updated
}

export async function deleteMemoryItem(selector: MemoryItemSelector) {
  const deleted = await db
    .delete(schema.memoryItems)
    .where(and(eq(schema.memoryItems.id, selector.id), scopeCondition(selector)))
    .returning({ id: schema.memoryItems.id })
  return deleted.length > 0
}
