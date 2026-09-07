import {
  createId,
  getProfile,
  getRoutine,
  listRoutines,
  routineDefinitionInputSchema,
  type RoutineOperation,
  type ModelToolCall,
  type ToolDefinition,
  validateRoutineSchedule,
} from '@openbot/db'
import * as z from 'zod'
import type { ToolTurnContext } from './send-message'

export const MANAGE_ROUTINE_TOOL_NAME = 'ManageRoutine'

export const manageRoutineArgsSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('list') }),
  z.object({ action: z.literal('get'), routine_id: z.string().min(1) }),
  z.object({
    action: z.literal('create'),
    name: z.string().trim().min(1).max(120),
    instruction: z.string().trim().min(1).max(20_000),
    cron: z.string().trim().min(1).max(100),
    timezone: z.string().trim().min(1).max(100).optional(),
    enabled: z.boolean().optional(),
  }),
  z.object({
    action: z.literal('update'),
    routine_id: z.string().min(1),
    name: z.string().trim().min(1).max(120).optional(),
    instruction: z.string().trim().min(1).max(20_000).optional(),
    cron: z.string().trim().min(1).max(100).optional(),
    timezone: z.string().trim().min(1).max(100).optional(),
  }),
  z.object({
    action: z.enum(['pause', 'resume', 'delete']),
    routine_id: z.string().min(1),
  }),
])

export const manageRoutineToolDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: MANAGE_ROUTINE_TOOL_NAME,
    description:
      'List, inspect, create, edit, pause, resume, or delete your recurring routines. ' +
      'Schedules use five-field cron in an IANA timezone and must be at least 15 minutes apart. ' +
      'Mutations require the user to approve the exact change.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['list', 'get', 'create', 'update', 'pause', 'resume', 'delete'],
        },
        routine_id: { type: 'string', description: 'Required except for list and create.' },
        name: { type: 'string' },
        instruction: { type: 'string' },
        cron: { type: 'string', description: 'Five-field cron expression.' },
        timezone: { type: 'string', description: 'IANA timezone, for example Europe/London.' },
        enabled: { type: 'boolean', description: 'Whether a newly created routine starts active.' },
      },
      required: ['action'],
      additionalProperties: false,
    },
  },
}

function routineView(routine: Awaited<ReturnType<typeof getRoutine>>) {
  if (!routine) return null
  return {
    id: routine.id,
    name: routine.name,
    instruction: routine.instruction,
    cron: routine.cronExpression,
    timezone: routine.timezone,
    enabled: routine.enabled,
    revision: routine.revision,
    next_run_at: routine.nextRunAt,
  }
}

function approvalCopy(operation: RoutineOperation) {
  if (operation.action === 'create') {
    return `create routine “${operation.name}” with schedule “${operation.cronExpression}” in ${operation.timezone} and instruction “${operation.instruction}”`
  }
  if (operation.action === 'update') {
    const changes = [
      operation.name !== undefined && `name to “${operation.name}”`,
      operation.instruction !== undefined && `instruction to “${operation.instruction}”`,
      operation.cronExpression !== undefined && `schedule to “${operation.cronExpression}”`,
      operation.timezone !== undefined && `timezone to ${operation.timezone}`,
    ].filter(Boolean)
    return `update routine ${operation.routineId}: ${changes.join(', ')}`
  }
  return `${operation.action} routine ${operation.routineId}`
}

export async function executeManageRoutine(
  agentId: string,
  args: z.infer<typeof manageRoutineArgsSchema>,
  call: ModelToolCall,
  context?: ToolTurnContext,
) {
  if (!context) return { error: 'ManageRoutine is unavailable in this execution context' }
  if (args.action === 'list') {
    return { routines: (await listRoutines(agentId)).map(routineView) }
  }
  if (args.action === 'get') {
    const routine = await getRoutine(args.routine_id)
    if (!routine || routine.agentId !== agentId) return { error: 'Routine not found' }
    return { routine: routineView(routine) }
  }

  let operation: RoutineOperation
  if (args.action === 'create') {
    const profile = await getProfile()
    const definition = routineDefinitionInputSchema.parse({
      name: args.name,
      instruction: args.instruction,
      cronExpression: args.cron,
      timezone: args.timezone ?? (profile.timezone || 'UTC'),
    })
    validateRoutineSchedule(definition.cronExpression, definition.timezone)
    operation = {
      action: 'create',
      routineId: createId('rtn'),
      ...definition,
      enabled: args.enabled ?? true,
    }
  } else {
    const routine = await getRoutine(args.routine_id)
    if (!routine || routine.agentId !== agentId) return { error: 'Routine not found' }
    if (args.action === 'update') {
      if (!args.name && !args.instruction && !args.cron && !args.timezone) {
        return { error: 'Pass at least one field to update' }
      }
      const definition = routineDefinitionInputSchema.parse({
        name: args.name ?? routine.name,
        instruction: args.instruction ?? routine.instruction,
        cronExpression: args.cron ?? routine.cronExpression,
        timezone: args.timezone ?? routine.timezone,
      })
      validateRoutineSchedule(definition.cronExpression, definition.timezone)
      operation = {
        action: 'update',
        routineId: routine.id,
        expectedRevision: routine.revision,
        ...(args.name !== undefined && { name: definition.name }),
        ...(args.instruction !== undefined && { instruction: definition.instruction }),
        ...(args.cron !== undefined && { cronExpression: definition.cronExpression }),
        ...(args.timezone !== undefined && { timezone: definition.timezone }),
      }
    } else {
      operation = {
        action: args.action,
        routineId: routine.id,
        expectedRevision: routine.revision,
      }
    }
  }

  const action = approvalCopy(operation)
  const prompt = `Allow OpenBot to ${action}?`
  const options = [
    { id: 'approve', label: 'Approve', style: 'primary' as const },
    { id: 'deny', label: 'Not now' },
  ]
  await context.suspend(
    {
      version: 1,
      interactionKind: 'approval',
      prompt,
      options,
      allowCustom: false,
      dismissOnMoveOn: false,
      originatingToolCall: { id: call.id, name: call.function.name },
      resumeData: { version: 1, type: 'routine-approval', operation },
      response: null,
    },
    {
      bodyText: prompt,
      payload: {
        version: 1,
        deliveryKind: 'send-message',
        type: 'widget',
        toolCallId: call.id,
        widget: {
          prompt,
          interactionKind: 'approval',
          options,
          allowCustom: false,
          dismissOnMoveOn: false,
        },
      },
    },
  )
  return { status: 'waiting_for_approval', operation: action }
}
