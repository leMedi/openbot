import type { ModelToolCall, ToolDefinition } from '@openbot/db'
import * as z from 'zod'
import type { ToolTurnContext } from './send-message'

export const CHECK_SUBAGENT_TOOL_NAME = 'CheckSubagent'
export const MESSAGE_SUBAGENT_TOOL_NAME = 'MessageSubagent'
export const STOP_SUBAGENT_TOOL_NAME = 'StopSubagent'

export const checkSubagentArgsSchema = z.object({
  subagent_id: z.string().trim().min(1).optional(),
}).strict()
export const messageSubagentArgsSchema = z.object({
  subagent_id: z.string().trim().min(1),
  message: z.string().trim().min(1).max(20_000),
}).strict()
export const stopSubagentArgsSchema = z.object({
  subagent_id: z.string().trim().min(1),
}).strict()

function definition(name: string, description: string, properties: Record<string, unknown>, required: string[] = []): ToolDefinition {
  return {
    type: 'function',
    function: {
      name,
      description,
      parameters: { type: 'object', properties, ...(required.length ? { required } : {}), additionalProperties: false },
    },
  }
}

export const checkSubagentToolDefinition = definition(
  CHECK_SUBAGENT_TOOL_NAME,
  'Inspect a background subagent you dispatched, or list active subagents. Use this to diagnose a long-running or stuck worker, not to poll for completion.',
  { subagent_id: { type: 'string', description: 'Subagent ID returned by Task. Omit to list active subagents.' } },
)
export const messageSubagentToolDefinition = definition(
  MESSAGE_SUBAGENT_TOOL_NAME,
  'Interrupt a running subagent with new guidance while preserving its isolated session and completed context.',
  {
    subagent_id: { type: 'string', description: 'Subagent ID returned by Task.' },
    message: { type: 'string', description: 'Course correction or additional information for the worker.' },
  },
  ['subagent_id', 'message'],
)
export const stopSubagentToolDefinition = definition(
  STOP_SUBAGENT_TOOL_NAME,
  'Cancel a queued or running subagent you dispatched and release its resources. It will not report a normal completion.',
  { subagent_id: { type: 'string', description: 'Subagent ID returned by Task.' } },
  ['subagent_id'],
)

export async function executeCheckSubagent(args: z.infer<typeof checkSubagentArgsSchema>, context?: ToolTurnContext) {
  if (!context?.listSubagents) return { error: 'Subagent management is unavailable in this turn' }
  const workers = await context.listSubagents()
  if (!args.subagent_id) return { subagents: workers }
  const worker = workers.find((candidate) => candidate.id === args.subagent_id)
  return worker ?? { error: `No accessible subagent ${args.subagent_id} was found` }
}

export async function executeMessageSubagent(
  args: z.infer<typeof messageSubagentArgsSchema>,
  call: ModelToolCall,
  context?: ToolTurnContext,
) {
  if (!context?.messageSubagent) return { error: 'Subagent steering is unavailable in this turn' }
  return context.messageSubagent({ subagentId: args.subagent_id, message: args.message, toolCallId: call.id })
}

export async function executeStopSubagent(args: z.infer<typeof stopSubagentArgsSchema>, context?: ToolTurnContext) {
  if (!context?.stopSubagent) return { error: 'Subagent cancellation is unavailable in this turn' }
  return context.stopSubagent(args.subagent_id)
}
