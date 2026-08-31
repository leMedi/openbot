import { eq } from 'drizzle-orm'
import { assertValidAvatarUpload, type AvatarUpload } from './avatars'
import { db } from './client'
import {
  createManagedFile,
  deleteManagedFileIfUnreferenced,
  readManagedFile,
} from './files'
import { createId } from './ids'
import * as schema from './schema'

export type AgentProfileInput = {
  name: string
  description?: string
  avatarShape?: string
  avatarColor?: string
  defaultMode?: string
  defaultModel?: string | null
  approvalMode?: string
  notifyOnUpdates?: boolean
  hiddenFromSidebar?: boolean
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

/**
 * Creates the agent together with its first conversation (titled after the
 * agent) in one transaction, so a new agent never exists without a room.
 */
export async function createAgent(input: AgentProfileInput) {
  const now = Date.now()
  return db.transaction(async (tx) => {
    const [agent] = await tx
      .insert(schema.agents)
      .values({
        id: createId('agt'),
        name: input.name,
        description: input.description ?? '',
        avatarShape: input.avatarShape ?? 'squircle',
        avatarColor: input.avatarColor ?? '#5865c4',
        defaultMode: input.defaultMode ?? 'default',
        defaultModel: input.defaultModel ?? null,
        approvalMode: input.approvalMode ?? 'allowlist',
        notifyOnUpdates: input.notifyOnUpdates ?? true,
        hiddenFromSidebar: input.hiddenFromSidebar ?? false,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
    const [conversation] = await tx
      .insert(schema.conversations)
      .values({
        id: createId('cnv'),
        ownerAgentId: agent.id,
        title: agent.name,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
    return { agent, conversation }
  })
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
