import { lookup } from 'node:dns/promises'
import { readFile, stat } from 'node:fs/promises'
import { isIP } from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createManagedFile,
  deleteManagedFileIfUnreferenced,
  hasAcceptedDirectAgentMessage,
  listAgents,
  listGroups,
  type Agent,
  type ModelToolCall,
  type ToolDefinition,
} from '@openbot/db'
import * as z from 'zod'
import type { ToolTurnContext } from './send-message'
import { agentWorkspaceDirectory, resolveWorkspacePath } from './shell/workspace'

export const SEND_TO_AGENT_TOOL_NAME = 'SendToAgent'

const imageSchema = z.object({
  url: z.string().trim().regex(/^(?:file|https):\/\//).max(2_000),
  alt: z.string().trim().max(500).optional(),
})

const extensionByMime: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
}
const supportedImageTypes = new Set(Object.keys(extensionByMime))

const MAX_IMAGE_BYTES = 25 * 1024 * 1024

function isPrivateAddress(address: string) {
  if (address === '::1' || address === '::') return true
  const lower = address.toLowerCase()
  if (lower.startsWith('::ffff:')) return isPrivateAddress(lower.slice(7))
  if (lower.startsWith('fc') || lower.startsWith('fd') || /^fe[89ab]/.test(lower)) return true
  const parts = address.split('.').map(Number)
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return false
  const [a, b] = parts
  return a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
}

async function assertPublicImageUrl(url: URL) {
  if (url.protocol !== 'https:') throw new Error('Remote images must use HTTPS')
  const hostname = url.hostname.toLowerCase()
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) {
    throw new Error('Remote image URL must use a public host')
  }
  const addresses = isIP(hostname)
    ? [{ address: hostname }]
    : await lookup(hostname, { all: true })
  if (addresses.length === 0 || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new Error('Remote image URL must use a public host')
  }
}

async function fetchImage(urlText: string) {
  let url = new URL(urlText)
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    await assertPublicImageUrl(url)
    const response = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(30_000),
    })
    if (response.status < 300 || response.status >= 400) return response
    const location = response.headers.get('location')
    if (!location) return response
    url = new URL(location, url)
  }
  throw new Error('Remote image redirected too many times')
}

async function readResponseBytes(response: Response) {
  const declaredSize = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredSize) && declaredSize > MAX_IMAGE_BYTES) {
    throw new Error('Image is too large')
  }
  if (!response.body) return new Uint8Array()
  const chunks: Uint8Array[] = []
  let byteLength = 0
  for await (const chunk of response.body) {
    byteLength += chunk.byteLength
    if (byteLength > MAX_IMAGE_BYTES) throw new Error('Image is too large')
    chunks.push(chunk)
  }
  const bytes = new Uint8Array(byteLength)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

async function materializeImages(agentId: string, images: z.infer<typeof imageSchema>[]) {
  const items = []
  const workspace = agentWorkspaceDirectory(agentId)
  try {
    for (const [position, image] of images.entries()) {
      let bytes: Uint8Array
      let mediaType: string
      let name: string
      if (image.url.startsWith('file://')) {
        const filePath = fileURLToPath(image.url)
        const resolved = resolveWorkspacePath(workspace, path.relative(workspace, filePath))
        if (!resolved) throw new Error('Image path must stay inside your workspace')
        const info = await stat(resolved)
        if (!info.isFile()) throw new Error(`${image.url} is not a file`)
        if (info.size > MAX_IMAGE_BYTES) throw new Error(`${image.url} is too large`)
        bytes = await readFile(resolved)
        name = path.basename(resolved)
        const extension = path.extname(resolved).slice(1).toLowerCase()
        mediaType = extension === 'jpg' || extension === 'jpeg'
          ? 'image/jpeg'
          : `image/${extension || 'png'}`
      } else {
        const response = await fetchImage(image.url)
        if (!response.ok) throw new Error(`Could not load image: ${image.url}`)
        bytes = await readResponseBytes(response)
        mediaType = response.headers.get('content-type')?.split(';')[0] ?? 'image/png'
        name = path.basename(new URL(image.url).pathname) || `image.${extensionByMime[mediaType] ?? 'png'}`
      }
      if (!supportedImageTypes.has(mediaType)) {
        throw new Error(`${image.url} is not a supported PNG, JPEG, GIF, or WebP image`)
      }
      if (bytes.byteLength > MAX_IMAGE_BYTES) throw new Error(`${image.url} is too large`)
      const extension = extensionByMime[mediaType] ?? (path.extname(name).slice(1) || 'png')
      const file = await createManagedFile({
        bytes,
        originalName: name,
        mediaType,
        subdirectory: 'agent-messages',
        extension,
      })
      items.push({
        fileId: file.id,
        position,
        metadata: {
          name,
          mediaType,
          byteSize: file.byteSize,
          ...(image.alt ? { alt: image.alt } : {}),
        },
      })
    }
  } catch (error) {
    await Promise.all(items.map((item) => deleteManagedFileIfUnreferenced(item.fileId)))
    throw error
  }
  return items.length > 0 ? { version: 1 as const, items } : undefined
}

export const sendToAgentArgsSchema = z.object({
  target_id: z.string().trim().min(1).max(200),
  message: z.string().trim().min(1).max(8_000),
  images: z.array(imageSchema).max(6).optional(),
  priority: z.boolean().optional(),
})

export const sendToAgentToolDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: SEND_TO_AGENT_TOOL_NAME,
    description:
      'Asynchronously message another local agent or post to a group you belong to by ID. ' +
      'This returns after durable queueing; any reply arrives on a later turn. Images and ' +
      'priority are supported for 1:1 messages; groups are text-only and ignore priority.',
    parameters: {
      type: 'object',
      properties: {
        target_id: {
          type: 'string',
          description: 'Exact agent or group ID from the directory in your system prompt.',
        },
        message: {
          type: 'string',
          description: 'A short, purposeful message to the target.',
        },
        images: {
          type: 'array',
          maxItems: 6,
          items: {
            type: 'object',
            properties: {
              url: { type: 'string', description: 'A file:// or https:// image URL.' },
              alt: { type: 'string', description: 'Optional image description.' },
            },
            required: ['url'],
            additionalProperties: false,
          },
        },
        priority: {
          type: 'boolean',
          description: 'Interrupt current non-user work for a 1:1 recipient. Ignored for groups.',
        },
      },
      required: ['target_id', 'message'],
      additionalProperties: false,
    },
  },
}

export async function executeSendToAgent(
  sender: Agent,
  args: z.infer<typeof sendToAgentArgsSchema>,
  call: ModelToolCall,
  context?: ToolTurnContext,
) {
  if (!context) return { error: 'SendToAgent is unavailable in this execution context' }
  if (args.target_id === sender.id) {
    return { error: "An agent can't message itself" }
  }
  const groups = await listGroups()
  const group = groups.find((candidate) => candidate.id === args.target_id)
  if (group) {
    if (!context.sendAgentGroupMessage) return { error: 'Group messaging is unavailable' }
    if (!group.membersJson.members.some((member) => member.agentId === sender.id)) {
      return { error: 'You can only post to a group you belong to' }
    }
    const delivery = await context.sendAgentGroupMessage({
      groupId: group.id,
      content: args.message,
      idempotencyKey: `agent-group:${sender.id}:${context.turnId}:${call.id}`,
    })
    return {
      ok: true,
      target: { id: group.id, name: group.name, kind: 'group' },
      recipientTurnId: delivery.turn.id,
      status: delivery.turn.status,
      ...(args.images?.length ? { note: 'Group messages are text-only; images were not delivered.' } : {}),
    }
  }

  const recipient = (await listAgents()).find((agent) => agent.id === args.target_id)
  if (!recipient) return { error: `No agent or group found with id ${args.target_id}` }
  const idempotencyKey = `direct-agent:${sender.id}:${context.turnId}:${call.id}`
  const alreadyAccepted = await hasAcceptedDirectAgentMessage(idempotencyKey)
  const attachments = alreadyAccepted
    ? undefined
    : await materializeImages(sender.id, args.images ?? [])
  let delivery
  try {
    delivery = await context.sendDirectAgentMessage({
      recipientAgentId: recipient.id,
      content: args.message,
      images: args.images,
      priority: args.priority,
      attachments,
      idempotencyKey,
    })
  } catch (error) {
    await Promise.all(
      (attachments?.items ?? []).map((item) => deleteManagedFileIfUnreferenced(item.fileId)),
    )
    throw error
  }
  return {
    ok: true,
    deliveryId: delivery.deliveryId,
    recipient: { id: recipient.id, name: recipient.name },
    recipientTurnId: delivery.turn.id,
    status: delivery.turn.status,
    asynchronous: true,
  }
}
