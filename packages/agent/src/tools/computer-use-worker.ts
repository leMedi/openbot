import type { ModelToolCall, ToolDefinition } from '@openbot/db'
import * as z from 'zod'
import type { ToolTurnContext } from './send-message'

export const COMPUTER_USE_WORKER_TOOL_NAME = 'computerUse'

export const computerUseWorkerArgsSchema = z.object({
  task: z.string().trim().min(1).max(20_000),
  title: z.string().trim().min(1).max(120).optional(),
}).strict()

export const computerUseWorkerToolDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: COMPUTER_USE_WORKER_TOOL_NAME,
    description:
      'Delegate one tightly scoped GUI task to an isolated computer-use worker. ' +
      'The worker cannot see the user message or prior conversation, so include the exact ' +
      'application or URL, values, success criteria, stopping point, and requested report. ' +
      'Only one worker can use this agent desktop at a time. It runs after this turn and ' +
      'automatically wakes you with its result; do not poll it or manipulate the desktop yourself.',
    parameters: {
      type: 'object',
      properties: {
        task: {
          type: 'string',
          minLength: 1,
          maxLength: 20_000,
          description: 'Self-contained desktop task for the worker.',
        },
        title: {
          type: 'string',
          minLength: 1,
          maxLength: 120,
          description: 'Short task label. Defaults to the beginning of the task.',
        },
      },
      required: ['task'],
      additionalProperties: false,
    },
  },
}

function defaultTitle(task: string) {
  const firstLine = task.split('\n', 1)[0]?.trim() ?? task
  return firstLine.length <= 120 ? firstLine : `${firstLine.slice(0, 117)}...`
}

export async function executeComputerUseWorker(
  args: z.infer<typeof computerUseWorkerArgsSchema>,
  call: ModelToolCall,
  context?: ToolTurnContext,
) {
  if (!context?.enqueueComputerUseWorker) {
    return { error: 'computerUse is unavailable in this turn' }
  }
  const worker = await context.enqueueComputerUseWorker({
    parentToolCallId: call.id,
    task: args.task,
    title: args.title ?? defaultTitle(args.task),
  })
  return {
    status: 'queued',
    worker_turn_id: worker.turnId,
    message: 'The computer-use worker will report back automatically. Do not poll it.',
  }
}
