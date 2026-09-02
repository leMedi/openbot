// The built-in agent toolset: aggregated tool definitions and the dispatcher
// that executes one model-requested tool call.

import type { Agent, ModelToolCall, ToolDefinition } from '@openbot/db'
import {
  executeRecallMemory,
  executeUpdateMemory,
  memoryToolDefinitions,
  recallMemoryArgsSchema,
  updateMemoryArgsSchema,
} from '@openbot/memory'
import * as z from 'zod'
import { executeRead, readArgsSchema, readToolDefinition } from './read'
import {
  executeSendAgentMessage,
  SEND_AGENT_MESSAGE_TOOL_NAME,
  sendAgentMessageArgsSchema,
  sendAgentMessageToolDefinition,
} from './send-agent-message'
import {
  executeSendMessage,
  SEND_MESSAGE_TOOL_NAME,
  sendMessageArgsSchema,
  sendMessageToolDefinition,
  type ToolTurnContext,
} from './send-message'
import {
  awaitShellArgsSchema,
  awaitShellToolDefinition,
  executeAwaitShell,
} from './shell/await-shell'
import {
  executeRunShell,
  runShellArgsSchema,
  runShellToolDefinition,
} from './shell/run-shell'

export { SEND_MESSAGE_TOOL_NAME }
export type { ToolTurnContext }

export const agentToolDefinitions: ToolDefinition[] = [
  sendMessageToolDefinition,
  sendAgentMessageToolDefinition,
  ...memoryToolDefinitions,
  runShellToolDefinition,
  readToolDefinition,
  awaitShellToolDefinition,
]

/** Degraded toolset for rounds after the tool budget runs out. */
export const sendMessageOnlyToolDefinitions: ToolDefinition[] = [
  sendMessageToolDefinition,
]

/** Background wakes may stay silent, but can surface a material outcome. */
export const backgroundToolDefinitions: ToolDefinition[] = agentToolDefinitions

/**
 * Executes one model-requested tool call and returns the tool-role message
 * content. Bad arguments come back as an error payload the model can correct
 * instead of failing the turn.
 */
export async function executeAgentToolCall(
  agent: Agent,
  call: ModelToolCall,
  context?: ToolTurnContext,
): Promise<string> {
  const respond = (payload: unknown) => JSON.stringify(payload)
  let args: unknown
  try {
    args = JSON.parse(call.function.arguments || '{}')
  } catch {
    return respond({ error: 'Tool arguments must be valid JSON' })
  }
  try {
    if (call.function.name === SEND_MESSAGE_TOOL_NAME) {
      return respond(
        await executeSendMessage(agent, sendMessageArgsSchema.parse(args), call, context),
      )
    }
    if (call.function.name === SEND_AGENT_MESSAGE_TOOL_NAME) {
      return respond(
        await executeSendAgentMessage(
          agent,
          sendAgentMessageArgsSchema.parse(args),
          call,
          context,
        ),
      )
    }
    if (call.function.name === 'updateMemory') {
      return respond(await executeUpdateMemory(agent, updateMemoryArgsSchema.parse(args)))
    }
    if (call.function.name === 'recallMemory') {
      return respond(await executeRecallMemory(agent, recallMemoryArgsSchema.parse(args)))
    }
    if (call.function.name === 'runShell') {
      return respond(await executeRunShell(agent, runShellArgsSchema.parse(args), context))
    }
    if (call.function.name === 'Read') {
      return respond(await executeRead(agent, readArgsSchema.parse(args)))
    }
    if (call.function.name === 'AwaitShell') {
      return respond(await executeAwaitShell(agent, awaitShellArgsSchema.parse(args)))
    }
    return respond({ error: `Unknown tool: ${call.function.name}` })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return respond({ error: `Invalid arguments: ${z.prettifyError(error)}` })
    }
    return respond({
      error: error instanceof Error ? error.message : 'Tool execution failed',
    })
  }
}
