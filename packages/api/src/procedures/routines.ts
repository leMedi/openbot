import { activateRoutineTurn, watchRoutineEvents } from '@openbot/agent'
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
import * as z from 'zod'
import { badRequest, base, notFound } from '../base'
import { fromWatcher } from '../watch'

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

export const routines = {
  list: base.input(listInput).handler(({ input }) => listRoutines(input.agentId)),

  history: base.input(idInput).handler(async ({ input }) => {
    const routine = await getRoutine(input.id)
    if (!routine) throw notFound(`Routine ${input.id} not found`)
    return listRoutineRuns(input.id)
  }),

  create: base.input(createInput).handler(({ input }) => createRoutine(input)),

  update: base.input(updateInput).handler(({ input }) => {
    const { id, ...patch } = input
    if (Object.keys(patch).length === 0) throw badRequest('No routine changes were provided')
    return updateRoutine(id, patch)
  }),

  setEnabled: base
    .input(enabledInput)
    .handler(({ input }) => setRoutineEnabled(input.id, input.enabled)),

  remove: base.input(deleteInput).handler(async ({ input }) => {
    if (!(await deleteRoutine(input.id))) throw notFound(`Routine ${input.id} not found`)
    return { id: input.id }
  }),

  run: base.input(idInput).handler(async ({ input }) => {
    const turn = await enqueueRoutineNow(input.id)
    activateRoutineTurn(turn)
    return turn
  }),

  /** Live routine lifecycle events (queued, message, settled) for every routine. */
  watch: base.handler(async function* ({ signal }) {
    yield* fromWatcher(watchRoutineEvents, signal)
  }),
}
