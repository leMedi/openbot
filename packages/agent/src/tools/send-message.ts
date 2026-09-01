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
  type ModelToolCall,
  type SendMessagePayload,
  type ToolDefinition,
} from '@openbot/db'
import * as z from 'zod'
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
      options: z
        .array(
          z.object({
            label: z.string().trim().min(1).max(200),
            value: z.string().trim().min(1).max(200).optional(),
          }),
        )
        .min(1)
        .max(8),
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
      'Deliver a message to the user. This is your ONLY way to communicate: ' +
      'plain assistant text is private working output and is never shown to ' +
      'the user — only messages sent with this tool appear in the chat. Use ' +
      'it for acknowledgements, progress updates, questions, and final ' +
      'answers. Each call appears immediately as one chat message; call it ' +
      'multiple times to send multiple messages. type "text" sends the ' +
      'Markdown in content (optionally set reply_to to the id of the ' +
      'transcript message you are replying to). type "widget" asks the user ' +
      'a multiple-choice question: the turn pauses after the current round ' +
      'and their selection arrives as the next user message. type ' +
      '"attachment" delivers a file from your workspace.',
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
                },
                required: ['label'],
                additionalProperties: false,
              },
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
  /** Set by a widget send: the runner suspends the turn after this round. */
  pendingWaiting?: {
    prompt: string
    options: { id: string; label: string }[]
    toolCallId: string
  }
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
  // The spec's waiting rejection: once a widget is pending, the turn is about
  // to suspend and nothing further may be delivered this round.
  if (context.pendingWaiting) {
    return {
      error: "Delivery rejected: already waiting for the user's widget response.",
    }
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
    }))
    if (new Set(options.map((option) => option.id)).size !== options.length) {
      return { error: 'Widget option values must be unique' }
    }
    const message = await appendDelivery(context, {
      bodyText: args.widget.prompt,
      payload: {
        version: 1,
        deliveryKind: 'send-message',
        type: 'widget',
        toolCallId: call.id,
        widget: { prompt: args.widget.prompt, options },
      },
    })
    context.pendingWaiting = {
      prompt: args.widget.prompt,
      options,
      toolCallId: call.id,
    }
    return {
      ...deliveredView(message),
      status: 'waiting',
      note:
        'Widget delivered. The turn pauses after this round; the user\'s ' +
        'selection arrives as the next user message.',
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
