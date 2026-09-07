import { activateRoutineTurn } from '@openbot/agent'
import {
  createRoutine,
  deleteRoutine,
  enqueueRoutineNow,
  getRoutine,
  listRoutineRuns,
  listRoutines,
  routineDefinitionInputSchema,
  setRoutineEnabled,
  updateRoutine,
} from '@openbot/db'
import { createServerFn } from '@tanstack/react-start'
import * as z from 'zod'

const idInput = z.object({ id: z.string().min(1) })
const listInput = z.object({ agentId: z.string().min(1).optional() })
const createInput = routineDefinitionInputSchema.extend({
  agentId: z.string().min(1),
  conversationId: z.string().min(1),
  enabled: z.boolean().optional(),
})
const updateInput = routineDefinitionInputSchema.partial().extend({
  id: z.string().min(1),
})
const enabledInput = idInput.extend({ enabled: z.boolean() })
const deleteInput = idInput.extend({ confirmed: z.literal(true) })

export const getRoutines = createServerFn({ method: 'GET' })
  .validator((input: unknown) => listInput.parse(input ?? {}))
  .handler(({ data }) => listRoutines(data.agentId))

export const getRoutineHistory = createServerFn({ method: 'GET' })
  .validator((input: unknown) => idInput.parse(input))
  .handler(async ({ data }) => {
    const routine = await getRoutine(data.id)
    if (!routine) throw new Error(`Routine ${data.id} not found`)
    return listRoutineRuns(data.id)
  })

export const addRoutine = createServerFn({ method: 'POST' })
  .validator((input: unknown) => createInput.parse(input))
  .handler(({ data }) => createRoutine(data))

export const editRoutine = createServerFn({ method: 'POST' })
  .validator((input: unknown) => updateInput.parse(input))
  .handler(({ data }) => {
    const { id, ...patch } = data
    if (Object.keys(patch).length === 0) throw new Error('No routine changes were provided')
    return updateRoutine(id, patch)
  })

export const changeRoutineEnabled = createServerFn({ method: 'POST' })
  .validator((input: unknown) => enabledInput.parse(input))
  .handler(({ data }) => setRoutineEnabled(data.id, data.enabled))

export const removeRoutine = createServerFn({ method: 'POST' })
  .validator((input: unknown) => deleteInput.parse(input))
  .handler(async ({ data }) => {
    if (!(await deleteRoutine(data.id))) throw new Error(`Routine ${data.id} not found`)
    return { id: data.id }
  })

export const runRoutine = createServerFn({ method: 'POST' })
  .validator((input: unknown) => idInput.parse(input))
  .handler(async ({ data }) => {
    const turn = await enqueueRoutineNow(data.id)
    activateRoutineTurn(turn)
    return turn
  })
