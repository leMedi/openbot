import {
  createMemoryItem,
  deleteMemoryItem,
  getMemoryItemForAgent,
  memoryKindSchema,
  searchMemoryForAgent,
  updateMemoryItem,
  type Agent,
  type MemoryItem,
  type ModelToolCall,
} from '@openbot/db'
import * as z from 'zod'
import type { ToolDefinition } from './ai'

const updateMemoryArgsSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('update'),
    id: z.string().min(1).optional(),
    scope: z.enum(['user', 'agent']).optional(),
    kind: memoryKindSchema.optional(),
    content: z.string().trim().min(1).max(20_000).optional(),
  }),
  z.object({
    action: z.literal('forget'),
    id: z.string().min(1),
  }),
])

const recallMemoryArgsSchema = z.object({
  query: z.string().trim().min(1).max(200),
  scope: z.enum(['user', 'agent']).optional(),
  limit: z.number().int().min(1).max(25).optional(),
})

export const agentToolDefinitions: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'updateMemory',
      description:
        'Change durable memory. action "update" with an id edits that item; ' +
        'without an id it records a new fact. action "forget" permanently ' +
        'deletes the item with the given id. scope "user" is shared with every ' +
        'assistant this user runs; scope "agent" is private to you (the default ' +
        'for new facts). You can only touch shared-user memory and your own.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['update', 'forget'] },
          id: {
            type: 'string',
            description:
              'Memory item id (mem_...). Required for "forget"; for "update", omit it to record a new fact.',
          },
          scope: {
            type: 'string',
            enum: ['user', 'agent'],
            description:
              'For new facts: "user" = shared across all of this user\'s assistants, "agent" = private to you. Defaults to "agent".',
          },
          kind: {
            type: 'string',
            enum: ['profile', 'log', 'note'],
            description:
              'Tier of the fact: "profile" for lasting facts, "log" for events, "note" for everything else (the default).',
          },
          content: {
            type: 'string',
            description: 'The fact to remember. Required when recording; optional when editing.',
          },
        },
        required: ['action'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'recallMemory',
      description:
        'Search durable memory for facts that are not already in your prompt. ' +
        'Searches shared-user memory plus memory scoped to you; pass scope ' +
        '"user" or "agent" to narrow it. The query matches item content ' +
        'case-insensitively, with "*" as the only wildcard. Results are ' +
        'ordered most recently updated first.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Text to look for; "*" matches any run of characters.' },
          scope: {
            type: 'string',
            enum: ['user', 'agent'],
            description: 'Optional filter: "user" = shared memory only, "agent" = your private memory only.',
          },
          limit: {
            type: 'integer',
            minimum: 1,
            maximum: 25,
            description: 'Maximum items to return (default 10).',
          },
        },
        required: ['query'],
        additionalProperties: false,
      },
    },
  },
]

function selectorFor(item: MemoryItem) {
  return item.scope === 'user'
    ? ({ id: item.id, scope: 'user' } as const)
    : ({
        id: item.id,
        scope: 'agent',
        // The scope CHECK constraint guarantees a subject on agent items.
        subjectAgentId: item.subjectAgentId ?? '',
      } as const)
}

function memoryItemView(item: MemoryItem) {
  return {
    id: item.id,
    scope: item.scope,
    kind: item.kind,
    content: item.content,
    learnedAt: new Date(item.createdAt).toISOString().slice(0, 10),
    via: item.authoredByAgentName,
  }
}

async function executeUpdateMemory(
  agent: Agent,
  args: z.infer<typeof updateMemoryArgsSchema>,
) {
  if (args.action === 'forget') {
    const item = await getMemoryItemForAgent(agent.id, args.id)
    if (!item) return { error: `Memory item ${args.id} was not found in memory you can access` }
    await deleteMemoryItem(selectorFor(item))
    return { forgotten: args.id }
  }
  if (args.id) {
    const item = await getMemoryItemForAgent(agent.id, args.id)
    if (!item) return { error: `Memory item ${args.id} was not found in memory you can access` }
    if (args.content === undefined && args.kind === undefined) {
      return { error: 'An update needs new content or a new kind' }
    }
    const updated = await updateMemoryItem(selectorFor(item), {
      ...(args.content !== undefined && { content: args.content }),
      ...(args.kind !== undefined && { kind: args.kind }),
    })
    return { updated: updated ? memoryItemView(updated) : undefined }
  }
  if (args.content === undefined) {
    return { error: 'Recording a new fact requires content' }
  }
  const scope = args.scope ?? 'agent'
  const created = await createMemoryItem({
    ...(scope === 'user'
      ? { scope: 'user' as const }
      : { scope: 'agent' as const, subjectAgentId: agent.id }),
    kind: args.kind ?? 'note',
    content: args.content,
    authoredByAgentId: agent.id,
    authoredByAgentName: agent.name,
  })
  return { created: memoryItemView(created) }
}

async function executeRecallMemory(
  agent: Agent,
  args: z.infer<typeof recallMemoryArgsSchema>,
) {
  const items = await searchMemoryForAgent(agent.id, args)
  return {
    count: items.length,
    items: items.map(memoryItemView),
  }
}

/**
 * Executes one model-requested tool call and returns the tool-role message
 * content. Bad arguments come back as an error payload the model can correct
 * instead of failing the turn.
 */
export async function executeAgentToolCall(
  agent: Agent,
  call: ModelToolCall,
): Promise<string> {
  const respond = (payload: unknown) => JSON.stringify(payload)
  let args: unknown
  try {
    args = JSON.parse(call.function.arguments || '{}')
  } catch {
    return respond({ error: 'Tool arguments must be valid JSON' })
  }
  try {
    if (call.function.name === 'updateMemory') {
      return respond(await executeUpdateMemory(agent, updateMemoryArgsSchema.parse(args)))
    }
    if (call.function.name === 'recallMemory') {
      return respond(await executeRecallMemory(agent, recallMemoryArgsSchema.parse(args)))
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
