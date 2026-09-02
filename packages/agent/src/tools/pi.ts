// Adapts the built-in agent tools and MCP gateway tools into pi custom
// tools, so pi's agent loop can call the existing executors unchanged.

import {
  defineTool,
  type ToolDefinition as PiToolDefinition,
} from '@earendil-works/pi-coding-agent'
import type { Agent, ModelToolCall, ToolDefinition } from '@openbot/db'
import type { McpToolRegistry } from '@openbot/plugins'
import type { TSchema } from 'typebox'
import { executeAgentToolCall, type ToolTurnContext } from './index'

function asToolCall(toolCallId: string, name: string, params: unknown): ModelToolCall {
  return {
    id: toolCallId,
    type: 'function',
    function: { name, arguments: JSON.stringify(params ?? {}) },
  }
}

function textResult(text: string) {
  return {
    content: [{ type: 'text' as const, text }],
    details: {},
  }
}

/**
 * Wraps the built-in tool definitions so pi dispatches into
 * executeAgentToolCall. No tool ends the run: the agent keeps working and
 * may deliver any number of SendMessage rows in one turn.
 */
export function toPiBuiltinTools(
  agent: Agent,
  definitions: ToolDefinition[],
  context: ToolTurnContext | undefined,
): PiToolDefinition[] {
  return definitions.map((definition) =>
    defineTool({
      name: definition.function.name,
      label: definition.function.name,
      description: definition.function.description,
      parameters: definition.function.parameters as TSchema,
      async execute(toolCallId, params) {
        console.info('[agent tool]', {
          agent: { id: agent.id, name: agent.name },
          tool: definition.function.name,
          arguments: params,
        })
        const result = await executeAgentToolCall(
          agent,
          asToolCall(toolCallId, definition.function.name, params),
          context,
        )
        return textResult(result)
      },
    }),
  )
}

/** Wraps a turn's MCP gateway tools so pi dispatches into the registry. */
export function toPiMcpTools(registry: McpToolRegistry): PiToolDefinition[] {
  return registry.definitions.map((definition) =>
    defineTool({
      name: definition.function.name,
      label: definition.function.name,
      description: definition.function.description,
      parameters: definition.function.parameters as TSchema,
      async execute(toolCallId, params, signal) {
        console.info('[agent tool]', { tool: definition.function.name, arguments: params })
        const result = await registry.execute(
          asToolCall(toolCallId, definition.function.name, params),
          signal,
        )
        return textResult(result)
      },
    }),
  )
}
