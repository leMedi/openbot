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
  const descriptions = [
    availableTypes.includes('executor') &&
      '- executor: Your workhorse: a background subagent with your full work toolset (runShell, Read, AwaitShell, and connected MCP tools) that executes one stream of work while you stay available to the user. Give each independent task its own executor — several run in parallel. Keep exactly one executor per stream of work: steer a follow-up or correction into the running one with MessageSubagent instead of dispatching a duplicate. It starts with no context: the dispatch prompt must be self-contained — the goal, the specifics, relevant conversation context, any of your memories or user preferences that matter, explicit success criteria, and what to report back. It runs in the background like any Task: you are notified when it finishes, so do not poll or await it. It runs headless and cannot talk to the user; it reports its result back to you, and you deliver it.',
    availableTypes.includes('computerUse') &&
      '- computerUse: Delegate a self-contained desktop task to a background subagent that drives your remote machine\'s desktop — GUI apps, file dialogs, drag interactions, and sites that defeat page-level automation — by screenshot, click, drag, type, key, scroll, and wait. For browser-only work, dispatch browserUse instead; use computerUse when the task needs the desktop itself or a browserUse dispatch reported a site it could not operate. It runs in the background like any Task: you are notified when it finishes, so do not poll or await it. It runs headless and cannot ask follow-ups, so give it a tightly-scoped, self-contained task — the smallest concrete step rather than a sprawling goal — with the specifics it needs (site, account, exact values), explicit success criteria and stopping point, and what to report back; break a big GUI goal into several narrow dispatches, and if one runs long or loops, steer it with MessageSubagent or stop it with StopSubagent. Only one computerUse subagent can run at a time, because they share your desktop\'s single screen — never dispatch a second while one is still running. It cannot act as the user: if a step needs a human (entering a password, 2FA, a captcha, a payment) it stops and reports back.',
    availableTypes.includes('browserUse') &&
      '- browserUse: Delegate a self-contained web task to a background subagent that drives your remote machine\'s browser at the page level — navigating, reading structured page snapshots, clicking elements by reference, filling forms, and taking screenshots — without touching the desktop\'s mouse or keyboard. Prefer it over computerUse for browser-only work: page snapshots give it exact element targets, so it is faster and more reliable than pixel clicking, and it shares the browser\'s persistent logins. Use computerUse instead when the task needs the desktop itself (GUI apps, file dialogs, drag interactions) or a site that defeats DOM automation. It runs in the background like any Task: you are notified when it finishes, so do not poll or await it. It runs headless and cannot ask follow-ups, so give it a tightly-scoped, self-contained task with the specifics it needs (site, exact values), explicit success criteria, and what to report back. Only one browserUse subagent can run at a time, because they share your browser — never dispatch a second while one is still running. It cannot act as the user: if a step needs a human (a password, 2FA, a captcha, a payment) it stops and reports back.',
  ].filter((description): description is string => !!description)
  return {
    type: 'function',
    function: {
      name: TASK_TOOL_NAME,
      description: [
        'Launch a new agent to handle complex, multi-step tasks autonomously.',
        '',
        'The Task tool launches specialized subagents that autonomously handle complex tasks. Each subagent_type has specific capabilities and tools available to it.',
        '',
        'When using the Task tool, you must specify a subagent_type parameter to select which agent type to use.',
        '',
        'When NOT to use the Task tool:',
        '- Simple, single or few-step tasks that can be performed by a single agent (using parallel or sequential tools) -- just call the tools directly instead.',
        '',
        'Usage notes:',
        '- Always include a short description (3-5 words) summarizing what the agent will do',
        '- Launch multiple executor agents concurrently whenever possible, to maximize performance; to do that, use a single message with multiple tool uses.',
        '- When the agent is done, it will return a single message back to you. Specify exactly what information the agent should return back to you. The result returned by the agent is not visible to the user. To show the user the result, you should send a text message back to the user with a concise summary of the result.',
        '- When using the Task tool, the subagent invocation does not have access to the user\'s message or prior assistant steps. Therefore, you should provide a highly detailed task description with all necessary context for the subagent to perform its task autonomously.',
        '- Clearly tell the subagent which tasks you want it to perform, since it is not aware of the user\'s intent or your prior assistant steps (tool calls, messages, or context).',
        '',
        'Available subagent_types and a quick description of what they do:',
        ...descriptions,
      ].join('\n'),
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
