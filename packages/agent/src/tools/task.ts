import type { ModelToolCall, ToolDefinition } from '@openbot/db'
import * as z from 'zod'
import type { ToolTurnContext } from './send-message'

export const TASK_TOOL_NAME = 'Task'
const subagentTypes = ['executor', 'computerUse', 'browserUse'] as const

export const taskArgsSchema = z.object({
  description: z.string().trim().min(1).max(120),
  prompt: z.string().trim().min(1).max(20_000),
  subagent_type: z.enum(subagentTypes),
}).strict()

function createTaskToolDefinition(
  availableTypes: readonly (typeof subagentTypes)[number][],
): ToolDefinition {
  const hasDesktopWorkers = availableTypes.length > 1
  return {
    type: 'function',
    function: {
      name: TASK_TOOL_NAME,
      description:
        'Start a temporary background subagent for a self-contained task. The subagent has isolated ' +
        'model history and reports back automatically. Use executor for parallel research, analysis, ' +
        'file processing, or work with an already connected MCP service' +
        (hasDesktopWorkers
          ? '. Use browserUse only for page-level web work after ruling out a suitable MCP tool or catalog plugin, ' +
            'and computerUse only for desktop GUI work or fallback after browserUse cannot complete the task. '
          : '. ') +
        'Do not poll for completion; use CheckSubagent only to diagnose a worker that may be stuck.',
      parameters: {
        type: 'object',
        properties: {
          description: {
            type: 'string', minLength: 1, maxLength: 120,
            description: 'Short, concrete, user-friendly title for the subagent.',
          },
          prompt: {
            type: 'string', minLength: 1, maxLength: 20_000,
            description: 'Self-contained task, required context, success criteria, and requested report.',
          },
          subagent_type: {
            type: 'string', enum: [...availableTypes],
            description: 'Worker specialization.',
          },
        },
        required: ['description', 'prompt', 'subagent_type'],
        additionalProperties: false,
      },
    },
  }
}

export const taskToolDefinition = createTaskToolDefinition(subagentTypes)
export const executorTaskToolDefinition = createTaskToolDefinition(['executor'])

export async function executeTask(
  args: z.infer<typeof taskArgsSchema>,
  call: ModelToolCall,
  context?: ToolTurnContext,
) {
  const input = { parentToolCallId: call.id, task: args.prompt, title: args.description }
  const enqueue = args.subagent_type === 'computerUse'
    ? context?.enqueueComputerUseWorker
    : args.subagent_type === 'browserUse'
      ? context?.enqueueBrowserUseWorker
      : context?.enqueueGeneralSubagent
  if (!enqueue) return { error: `Task subagent type ${args.subagent_type} is unavailable in this turn` }
  const worker = await enqueue(input)
  return {
    status: 'queued',
    subagent_id: worker.turnId,
    worker_turn_id: worker.turnId,
    subagent_type: args.subagent_type,
    message: 'The subagent is running in the background and will report back automatically.',
  }
}
