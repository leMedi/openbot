import { and, asc, desc, eq, inArray, lte, sql } from 'drizzle-orm'
import { db } from './client'
import type { DbExecutor } from './conversations'
import { createId } from './ids'
import {
  type RoutineOperation,
  routineOperationSchema,
  routineWakeSchema,
} from './json-schemas'
import {
  nextCronOccurrence,
  routineDefinitionInputSchema,
  validateRoutineSchedule,
} from './routine-schedule'
import * as schema from './schema'

export const MAX_ROUTINES_PER_AGENT = 50
export const ROUTINE_RUN_HISTORY_LIMIT = 20

export type RoutineCreateInput = {
  id?: string
  agentId: string
  conversationId: string
  name: string
  instruction: string
  cronExpression: string
  timezone: string
  enabled?: boolean
}

export type RoutineUpdateInput = Partial<
  Pick<RoutineCreateInput, 'name' | 'instruction' | 'cronExpression' | 'timezone'>
> & { expectedRevision?: number }

async function requireRoutineConversation(
  executor: DbExecutor,
  agentId: string,
  conversationId: string,
) {
  const [conversation] = await executor
    .select()
    .from(schema.conversations)
    .where(eq(schema.conversations.id, conversationId))
    .limit(1)
  if (!conversation || conversation.ownerAgentId !== agentId) {
    throw new Error('A routine must deliver to a private conversation owned by its agent')
  }
}

export async function getRoutine(id: string) {
  const [routine] = await db
    .select()
    .from(schema.routines)
    .where(eq(schema.routines.id, id))
    .limit(1)
  return routine
}

export function listRoutines(agentId?: string) {
  return agentId
    ? db.select().from(schema.routines)
        .where(eq(schema.routines.agentId, agentId))
        .orderBy(asc(schema.routines.createdAt), asc(schema.routines.id))
    : db.select().from(schema.routines)
        .orderBy(asc(schema.routines.createdAt), asc(schema.routines.id))
}

export async function createRoutine(input: RoutineCreateInput) {
  const definition = routineDefinitionInputSchema.parse(input)
  validateRoutineSchedule(definition.cronExpression, definition.timezone)
  const enabled = input.enabled ?? true
  const now = Date.now()
  return db.transaction(async (tx) => {
    if (input.id) {
      const [existing] = await tx
        .select()
        .from(schema.routines)
        .where(eq(schema.routines.id, input.id))
        .limit(1)
      if (existing) return existing
    }
    await requireRoutineConversation(tx, input.agentId, input.conversationId)
    const [{ count }] = await tx
      .select({ count: sql<number>`count(*)` })
      .from(schema.routines)
      .where(eq(schema.routines.agentId, input.agentId))
    if (Number(count) >= MAX_ROUTINES_PER_AGENT) {
      throw new Error(`An agent can have at most ${MAX_ROUTINES_PER_AGENT} routines`)
    }
    const [created] = await tx
      .insert(schema.routines)
      .values({
        id: input.id ?? createId('rtn'),
        agentId: input.agentId,
        conversationId: input.conversationId,
        ...definition,
        enabled,
        nextRunAt: enabled
          ? nextCronOccurrence(definition.cronExpression, definition.timezone, now)
          : null,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
    if (!created) throw new Error('Routine could not be created')
    return created
  })
}

export async function updateRoutine(id: string, input: RoutineUpdateInput) {
  const current = await getRoutine(id)
  if (!current) throw new Error(`Routine ${id} not found`)
  if (input.expectedRevision !== undefined && input.expectedRevision !== current.revision) {
    const unchanged = Object.entries(input).every(([key, value]) =>
      key === 'expectedRevision' || current[key as keyof typeof current] === value)
    if (unchanged) return current
    throw new Error('The routine changed after approval; review it again')
  }
  const definition = routineDefinitionInputSchema.parse({
    name: input.name ?? current.name,
    instruction: input.instruction ?? current.instruction,
    cronExpression: input.cronExpression ?? current.cronExpression,
    timezone: input.timezone ?? current.timezone,
  })
  validateRoutineSchedule(definition.cronExpression, definition.timezone)
  const scheduleChanged = definition.cronExpression !== current.cronExpression
    || definition.timezone !== current.timezone
  const now = Date.now()
  const [updated] = await db
    .update(schema.routines)
    .set({
      ...definition,
      revision: current.revision + 1,
      ...(current.enabled && scheduleChanged && {
        nextRunAt: nextCronOccurrence(definition.cronExpression, definition.timezone, now),
      }),
      updatedAt: now,
    })
    .where(and(
      eq(schema.routines.id, id),
      eq(schema.routines.revision, current.revision),
    ))
    .returning()
  if (!updated) throw new Error('The routine changed while it was being updated')
  return updated
}

export async function setRoutineEnabled(
  id: string,
  enabled: boolean,
  expectedRevision?: number,
) {
  const current = await getRoutine(id)
  if (!current) throw new Error(`Routine ${id} not found`)
  if (expectedRevision !== undefined && current.revision !== expectedRevision) {
    if (current.enabled === enabled) return current
    throw new Error('The routine changed after approval; review it again')
  }
  if (current.enabled === enabled) return current
  const now = Date.now()
  const [updated] = await db
    .update(schema.routines)
    .set({
      enabled,
      nextRunAt: enabled
        ? nextCronOccurrence(current.cronExpression, current.timezone, now)
        : null,
      revision: current.revision + 1,
      updatedAt: now,
    })
    .where(and(
      eq(schema.routines.id, id),
      eq(schema.routines.revision, current.revision),
    ))
    .returning()
  if (!updated) throw new Error('The routine changed while it was being updated')
  return updated
}

export async function deleteRoutine(id: string, expectedRevision?: number) {
  const deleted = await db
    .delete(schema.routines)
    .where(expectedRevision === undefined
      ? eq(schema.routines.id, id)
      : and(
          eq(schema.routines.id, id),
          eq(schema.routines.revision, expectedRevision),
        ))
    .returning({ id: schema.routines.id })
  if (deleted.length === 0 && expectedRevision !== undefined && await getRoutine(id)) {
    throw new Error('The routine changed after approval; review it again')
  }
  return deleted.length > 0
}

export function listRoutineRuns(routineId: string, limit = ROUTINE_RUN_HISTORY_LIMIT) {
  return db
    .select()
    .from(schema.turns)
    .where(eq(schema.turns.routineId, routineId))
    .orderBy(desc(schema.turns.createdAt), desc(schema.turns.id))
    .limit(Math.max(1, Math.min(limit, ROUTINE_RUN_HISTORY_LIMIT)))
}

async function insertRoutineTurn(
  executor: DbExecutor,
  routine: typeof schema.routines.$inferSelect,
  scheduledFor: number,
  idempotencyKey: string,
) {
  const wake = routineWakeSchema.parse({
    version: 1,
    type: 'routine',
    routineId: routine.id,
    routineRevision: routine.revision,
    name: routine.name,
    instruction: routine.instruction,
    cronExpression: routine.cronExpression,
    timezone: routine.timezone,
    enabled: routine.enabled,
    nextRunAt: routine.nextRunAt,
    scheduledFor,
  })
  const now = Date.now()
  const [turn] = await executor
    .insert(schema.turns)
    .values({
      id: createId('trn'),
      conversationId: routine.conversationId,
      targetAgentId: routine.agentId,
      routineId: routine.id,
      lane: 'background',
      source: 'routine',
      status: 'queued',
      idempotencyKey,
      runtimeContextJson: { version: 1, wake },
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing({ target: schema.turns.idempotencyKey })
    .returning()
  if (turn) return turn
  const [existing] = await executor
    .select()
    .from(schema.turns)
    .where(eq(schema.turns.idempotencyKey, idempotencyKey))
    .limit(1)
  if (!existing) throw new Error('Routine turn could not be queued')
  return existing
}

/** Atomically coalesces each due routine into at most one unsettled turn. */
export function enqueueDueRoutineRuns(now = Date.now()) {
  return db.transaction(async (tx) => {
    const due = await tx
      .select()
      .from(schema.routines)
      .where(and(
        eq(schema.routines.enabled, true),
        lte(schema.routines.nextRunAt, now),
      ))
      .orderBy(asc(schema.routines.nextRunAt), asc(schema.routines.id))
    const queued: Array<typeof schema.turns.$inferSelect> = []
    for (const routine of due) {
      if (routine.nextRunAt == null) continue
      const [unsettled] = await tx
        .select({ id: schema.turns.id })
        .from(schema.turns)
        .where(and(
          eq(schema.turns.routineId, routine.id),
          inArray(schema.turns.status, ['queued', 'running', 'waiting']),
        ))
        .limit(1)
      // Leave nextRunAt overdue while occupied. As soon as the active run
      // settles, the next poll coalesces every missed slot into one run.
      if (unsettled) continue
      const scheduledFor = routine.nextRunAt
      const turn = await insertRoutineTurn(
        tx,
        routine,
        scheduledFor,
        `routine:${routine.id}:${scheduledFor}`,
      )
      queued.push(turn)
      await tx
        .update(schema.routines)
        .set({
          nextRunAt: nextCronOccurrence(
            routine.cronExpression,
            routine.timezone,
            now,
          ),
          updatedAt: now,
        })
        .where(eq(schema.routines.id, routine.id))
    }
    return queued
  })
}

export function enqueueRoutineNow(id: string) {
  return db.transaction(async (tx) => {
    const [routine] = await tx
      .select()
      .from(schema.routines)
      .where(eq(schema.routines.id, id))
      .limit(1)
    if (!routine) throw new Error(`Routine ${id} not found`)
    const [unsettled] = await tx
      .select()
      .from(schema.turns)
      .where(and(
        eq(schema.turns.routineId, id),
        inArray(schema.turns.status, ['queued', 'running', 'waiting']),
      ))
      .limit(1)
    if (unsettled) return unsettled
    const now = Date.now()
    return insertRoutineTurn(tx, routine, now, `routine:${routine.id}:manual:${createId('chk')}`)
  })
}

export async function applyRoutineOperation(
  agentId: string,
  conversationId: string,
  value: RoutineOperation,
) {
  const operation = routineOperationSchema.parse(value)
  if (operation.action === 'create') {
    return createRoutine({
      id: operation.routineId,
      agentId,
      conversationId,
      name: operation.name,
      instruction: operation.instruction,
      cronExpression: operation.cronExpression,
      timezone: operation.timezone,
      enabled: operation.enabled,
    })
  }
  const routine = await getRoutine(operation.routineId)
  if (routine && routine.agentId !== agentId) throw new Error('Routine belongs to another agent')
  if (operation.action === 'delete') {
    if (!routine) return { id: operation.routineId, deleted: true }
    await deleteRoutine(operation.routineId, operation.expectedRevision)
    return { id: operation.routineId, deleted: true }
  }
  if (!routine) throw new Error(`Routine ${operation.routineId} not found`)
  if (operation.action === 'pause') {
    return setRoutineEnabled(routine.id, false, operation.expectedRevision)
  }
  if (operation.action === 'resume') {
    return setRoutineEnabled(routine.id, true, operation.expectedRevision)
  }
  if (operation.action === 'update') return updateRoutine(routine.id, operation)
  throw new Error(`Unsupported routine operation: ${operation.action}`)
}
