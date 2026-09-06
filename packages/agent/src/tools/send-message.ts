// The SendMessage tool: the agent's only channel to the user. Handles text,
// widget, and attachment deliveries plus the per-turn delivery context.

import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import {
  appendConversationMessage,
  createManagedFile,
  listConversationMessages,
  type Agent,
  type ConversationMessage,
  type DirectAgentMessageInput,
  type ModelToolCall,
  type SendMessagePayload,
  type ToolDefinition,
  type Turn,
  type VersionedObject,
  type WaitingState,
} from '@openbot/db'
import * as z from 'zod'
import type { DesktopToolRuntime } from '../desktop/runtime'
import { agentWorkspaceDirectory, resolveWorkspacePath } from './shell/workspace'

export const SEND_MESSAGE_TOOL_NAME = 'SendMessage'

export const sendMessageArgsSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('text'),
    content: z.string().trim().min(1).max(20_000),
    reply_to: z.string().trim().min(1).optional(),
  }),
  z.object({
    type: z.literal('widget'),
    widget: z.object({
      prompt: z.string().trim().min(1).max(2_000),
      helpText: z.string().trim().min(1).max(2_000).optional(),
      options: z
        .array(
          z.object({
            label: z.string().trim().min(1).max(200),
            value: z.string().trim().min(1).max(200).optional(),
            description: z.string().trim().min(1).max(500).optional(),
            style: z.enum(['primary', 'danger']).optional(),
          }),
        )
        .min(1)
        .max(8),
      allowCustom: z.boolean().optional(),
      dismissOnMoveOn: z.boolean().optional(),
    }),
  }),
  z.object({
    type: z.literal('attachment'),
    path: z.string().trim().min(1).max(1_000),
    alt: z.string().trim().max(500).optional(),
  }),
])

export const sendMessageToolDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: SEND_MESSAGE_TOOL_NAME,
    description:
      'Deliver one visible chat message. type "text" sends the Markdown in ' +
      'content (optionally ' +
      'set reply_to to the id of the transcript message you are replying ' +
      'to). type "widget" asks the user a multiple-choice question; their ' +
      'selection arrives as a later user message. type "attachment" ' +
      'delivers a file from your workspace.',
    parameters: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['text', 'widget', 'attachment'],
          description: 'Kind of message to send.',
        },
        content: {
          type: 'string',
          description: 'The message text, in Markdown. Required for type "text".',
        },
        reply_to: {
          type: 'string',
          description: 'Optional id of an earlier message this replies to (type "text").',
        },
        widget: {
          type: 'object',
          description: 'The question to ask. Required for type "widget".',
          properties: {
            prompt: { type: 'string', description: 'The question shown to the user.' },
            helpText: {
              type: 'string',
              description: 'Optional supporting text shown below the question.',
            },
            options: {
              type: 'array',
              minItems: 1,
              maxItems: 8,
              description: 'The choices offered, in display order.',
              items: {
                type: 'object',
                properties: {
                  label: { type: 'string', description: 'Text shown on the option.' },
                  value: {
                    type: 'string',
                    description: 'Optional stable id reported back on selection.',
                  },
                  description: {
                    type: 'string',
                    description:
                      'Optional one-line consequence of picking this option, shown under the label.',
                  },
                  style: {
                    type: 'string',
                    enum: ['primary', 'danger'],
                    description: 'Optional visual emphasis for this choice.',
                  },
                },
                required: ['label'],
                additionalProperties: false,
              },
            },
            allowCustom: {
              type: 'boolean',
              description: 'Allow the user to type an answer instead of selecting an option.',
            },
            dismissOnMoveOn: {
              type: 'boolean',
              description: 'Dismiss this low-stakes question when the user sends a newer message.',
            },
          },
          required: ['prompt', 'options'],
          additionalProperties: false,
        },
        path: {
          type: 'string',
          description:
            'Workspace-relative path of the file to deliver. Required for type "attachment".',
        },
        alt: {
          type: 'string',
          description: 'Optional short description of the attachment.',
        },
      },
      required: ['type'],
      additionalProperties: false,
    },
  },
}

/**
 * Per-turn execution context handed to tools that produce conversation
 * effects. Tools without conversation effects ignore it entirely.
 */
export type ToolTurnContext = {
  turnId: string
  conversationId: string
  /** Recorded on delivered rows; the member agent in group rooms, null in private rooms. */
  senderAgentId: string | null
  /** Rows already delivered for this turn by an interrupted attempt (replay dedupe). */
  priorDeliveries: ConversationMessage[]
  /** Called after a delivery row is committed; the runner streams and counts it. */
  onDelivered: (message: ConversationMessage) => void
  /** Persists a waiting interaction and stops the current model loop. */
  suspend: (
    state: WaitingState,
    delivery: { bodyText: string; payload: SendMessagePayload },
  ) => Promise<ConversationMessage | undefined>
  /** Queues hidden work that may outlive the current turn. */
  enqueueBackgroundWake: (input: {
    source: string
    idempotencyKey: string
    runtimeContext: VersionedObject
  }) => Promise<void>
  /** Queues one isolated computer-use child under this turn. */
  enqueueComputerUseWorker?: (input: {
    parentToolCallId: string
    task: string
    title: string
  }) => Promise<{ turnId: string }>
  /** Atomically accepts direct delivery and queues the recipient without waiting. */
  sendDirectAgentMessage: (
    input: Omit<DirectAgentMessageInput, 'senderAgentId'>,
  ) => Promise<{ deliveryId: string; turn: Turn }>
  /** Fresh server-local Remote Desktop capability for this turn. */
  desktop?: DesktopToolRuntime
  /** Optional runtime gate for legacy parent turns that resumed an old approval. */
  allowComputerCall?: () => boolean
}

const ATTACHMENT_SIZE_LIMIT = 25 * 1024 * 1024

const mediaTypeByExtension: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
  txt: 'text/plain',
  md: 'text/markdown',
  json: 'application/json',
  csv: 'text/csv',
  html: 'text/html',
  zip: 'application/zip',
  mp3: 'audio/mpeg',
  mp4: 'video/mp4',
}

function deliveredView(message: ConversationMessage) {
  return {
    ok: true,
    messageId: message.id,
    deliveredAt: message.createdAt,
  }
}

async function appendDelivery(
  context: ToolTurnContext,
  input: {
    bodyText: string
    payload: SendMessagePayload
    replyToEntryId?: string | null
    attachments?: { fileId: string; name: string; mediaType: string; byteSize: number }
  },
) {
  const message = await appendConversationMessage({
    conversationId: context.conversationId,
    kind: 'message',
    role: 'assistant',
    direction: 'outbound',
    bodyText: input.bodyText,
    payload: input.payload,
    turnId: context.turnId,
    senderAgentId: context.senderAgentId,
    replyToEntryId: input.replyToEntryId,
    ...(input.attachments && {
      attachments: {
        version: 1 as const,
        items: [
          {
            fileId: input.attachments.fileId,
            position: 0,
            metadata: {
              name: input.attachments.name,
              mediaType: input.attachments.mediaType,
              byteSize: input.attachments.byteSize,
            },
          },
        ],
      },
    }),
  })
  context.onDelivered(message)
  return message
}

export async function executeSendMessage(
  agent: Agent,
  args: z.infer<typeof sendMessageArgsSchema>,
  call: ModelToolCall,
  context: ToolTurnContext | undefined,
) {
  if (!context) {
    return { error: 'SendMessage is unavailable in this execution context' }
  }

  if (args.type === 'text') {
    // Semantic exactly-once across a crash/restart: an identical text from
    // the interrupted attempt was already seen by the user.
    const replayed = context.priorDeliveries.find(
      (row) => row.payloadJson.type === 'text' && row.bodyText === args.content,
    )
    if (replayed) {
      return { ok: true, messageId: replayed.id, note: 'already delivered' }
    }
    // An unknown or foreign reply target degrades to a plain message, same
    // as the composer boundary.
    let replyToEntryId: string | null = null
    if (args.reply_to) {
      const rows = await listConversationMessages(context.conversationId)
      replyToEntryId = rows.find((row) => row.id === args.reply_to)?.id ?? null
    }
    const message = await appendDelivery(context, {
      bodyText: args.content,
      payload: {
        version: 1,
        deliveryKind: 'send-message',
        type: 'text',
        toolCallId: call.id,
      },
      replyToEntryId,
    })
    return deliveredView(message)
  }

  if (args.type === 'widget') {
    const options = args.widget.options.map((option, index) => ({
      id: option.value ?? `opt_${index + 1}`,
      label: option.label,
      ...(option.description && { description: option.description }),
      ...(option.style && { style: option.style }),
    }))
    if (new Set(options.map((option) => option.id)).size !== options.length) {
      return { error: 'Widget option values must be unique' }
    }
    const payload: SendMessagePayload = {
      version: 1,
      deliveryKind: 'send-message',
      type: 'widget',
      toolCallId: call.id,
      widget: {
        prompt: args.widget.prompt,
        ...(args.widget.helpText && { helpText: args.widget.helpText }),
        interactionKind: 'question',
        options,
        allowCustom: args.widget.allowCustom ?? false,
        dismissOnMoveOn: args.widget.dismissOnMoveOn ?? false,
      },
    }
    const waitingState: WaitingState = {
      version: 1,
      interactionKind: 'question',
      prompt: args.widget.prompt,
      ...(args.widget.helpText && { helpText: args.widget.helpText }),
      options,
      allowCustom: args.widget.allowCustom ?? false,
      dismissOnMoveOn: args.widget.dismissOnMoveOn ?? false,
      originatingToolCall: { id: call.id, name: call.function.name },
      resumeData: { toolCallId: call.id },
      response: null,
    }
    const message = await context.suspend(waitingState, {
      bodyText: args.widget.prompt,
      payload,
    })
    if (!message) {
      return { error: 'The turn could not be suspended for this question' }
    }
    return {
      ...deliveredView(message),
      note: "Widget delivered. The turn is suspended until the user responds.",
    }
  }

  // args.type === 'attachment'
  const workspace = agentWorkspaceDirectory(agent.id)
  const resolved = resolveWorkspacePath(workspace, args.path)
  if (resolved === null) return { error: 'path must stay inside your workspace' }
  const info = await stat(resolved).catch(() => null)
  if (!info) return { error: `File not found: ${args.path}` }
  if (info.isDirectory()) return { error: `${args.path} is a directory, not a file` }
  if (info.size > ATTACHMENT_SIZE_LIMIT) {
    return { error: `File is too large to send (${info.size} bytes, limit ${ATTACHMENT_SIZE_LIMIT})` }
  }

  const name = path.basename(resolved)
  const extension = path.extname(name).slice(1).toLowerCase()
  const mediaType = mediaTypeByExtension[extension] ?? 'application/octet-stream'
  const bytes = await readFile(resolved)
  const file = await createManagedFile({
    bytes,
    originalName: name,
    mediaType,
    subdirectory: 'attachments',
    extension: extension || 'bin',
  })
  const message = await appendDelivery(context, {
    bodyText: args.alt ?? name,
    payload: {
      version: 1,
      deliveryKind: 'send-message',
      type: 'attachment',
      toolCallId: call.id,
      ...(args.alt && { alt: args.alt }),
    },
    attachments: {
      fileId: file.id,
      name,
      mediaType,
      byteSize: file.byteSize,
    },
  })
  return {
    ...deliveredView(message),
    fileId: file.id,
    name,
    byteSize: file.byteSize,
  }
}
