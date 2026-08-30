import { eq } from 'drizzle-orm'
import { db } from './client'
import {
  createManagedFile,
  deleteManagedFileIfUnreferenced,
  extensionForMediaType,
  readManagedFile,
} from './files'
import { createId } from './ids'
import * as schema from './schema'

export const AVATAR_MEDIA_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
] as const

export const MAX_AVATAR_BYTES = 5 * 1024 * 1024

export type AgentProfileInput = {
  name: string
  description?: string
  title?: string
  defaultMode?: string
  defaultModel?: string | null
  approvalMode?: string
  notifyOnUpdates?: boolean
  hiddenFromSidebar?: boolean
}

export type AvatarUpload = {
  bytes: Uint8Array
  originalName: string
  mediaType: string
}

export function listAgents() {
  return db.select().from(schema.agents).orderBy(schema.agents.createdAt)
}

export async function getAgent(id: string) {
  const [agent] = await db
    .select()
    .from(schema.agents)
    .where(eq(schema.agents.id, id))
    .limit(1)
  return agent
}

export async function createAgent(input: AgentProfileInput) {
  const now = Date.now()
  const [created] = await db
    .insert(schema.agents)
    .values({
      id: createId('agt'),
      name: input.name,
      description: input.description ?? '',
      title: input.title ?? '',
      defaultMode: input.defaultMode ?? 'default',
      defaultModel: input.defaultModel ?? null,
      approvalMode: input.approvalMode ?? 'allowlist',
      notifyOnUpdates: input.notifyOnUpdates ?? true,
      hiddenFromSidebar: input.hiddenFromSidebar ?? false,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
  return created
}

export async function updateAgentProfile(
  id: string,
  patch: Partial<AgentProfileInput>,
) {
  const [updated] = await db
    .update(schema.agents)
    .set({ ...patch, updatedAt: Date.now() })
    .where(eq(schema.agents.id, id))
    .returning()
  return updated
}

function assertValidAvatarUpload(upload: AvatarUpload) {
  if (!(AVATAR_MEDIA_TYPES as readonly string[]).includes(upload.mediaType)) {
    throw new Error(`Unsupported avatar media type: ${upload.mediaType}`)
  }
  if (!extensionForMediaType(upload.mediaType)) {
    throw new Error(`Unsupported avatar media type: ${upload.mediaType}`)
  }
  if (upload.bytes.byteLength === 0) {
    throw new Error('Avatar upload is empty')
  }
  if (upload.bytes.byteLength > MAX_AVATAR_BYTES) {
    throw new Error('Avatar upload exceeds the maximum size')
  }
}

export async function setAgentAvatar(agentId: string, upload: AvatarUpload) {
  assertValidAvatarUpload(upload)
  const existing = await getAgent(agentId)
  if (!existing) throw new Error(`Agent ${agentId} not found`)

  const file = await createManagedFile({
    bytes: upload.bytes,
    originalName: upload.originalName,
    mediaType: upload.mediaType,
    subdirectory: 'avatars',
  })

  const [updated] = await db
    .update(schema.agents)
    .set({ avatarFileId: file.id, updatedAt: Date.now() })
    .where(eq(schema.agents.id, agentId))
    .returning()
  if (!updated) {
    await deleteManagedFileIfUnreferenced(file.id)
    throw new Error(`Agent ${agentId} not found`)
  }

  if (existing.avatarFileId && existing.avatarFileId !== file.id) {
    await deleteManagedFileIfUnreferenced(existing.avatarFileId)
  }
  return updated
}

export async function removeAgentAvatar(agentId: string) {
  const existing = await getAgent(agentId)
  if (!existing) throw new Error(`Agent ${agentId} not found`)
  if (!existing.avatarFileId) return existing

  const [updated] = await db
    .update(schema.agents)
    .set({ avatarFileId: null, updatedAt: Date.now() })
    .where(eq(schema.agents.id, agentId))
    .returning()

  await deleteManagedFileIfUnreferenced(existing.avatarFileId)
  return updated ?? existing
}

export async function getAgentAvatarFile(agentId: string) {
  const agent = await getAgent(agentId)
  if (!agent?.avatarFileId) return undefined
  return readManagedFile(agent.avatarFileId)
}
