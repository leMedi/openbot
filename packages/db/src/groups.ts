import { eq, inArray } from 'drizzle-orm'
import { assertValidAvatarUpload, type AvatarUpload } from './avatars'
import { db } from './client'
import type { DbExecutor } from './conversations'
import {
  createManagedFile,
  deleteManagedFileIfUnreferenced,
  readManagedFile,
} from './files'
import { createId } from './ids'
import { type GroupMembers, groupMembersSchema } from './json-schemas'
import * as schema from './schema'

export type GroupMemberInput = GroupMembers['members'][number]

export type GroupProfileInput = {
  name: string
  description?: string
  members?: GroupMemberInput[]
}

/**
 * Validates a full membership list against the versioned contract: shape,
 * no duplicate members, and every referenced local agent must exist. Member
 * IDs live inside JSON, so this validation is the only integrity boundary —
 * SQLite cannot enforce foreign keys into the array.
 */
async function validateMembers(
  executor: DbExecutor,
  members: GroupMemberInput[],
): Promise<GroupMembers> {
  const parsed = groupMembersSchema.parse({ version: 1, members })

  const agentIds = parsed.members.map((m) => m.agentId)
  if (new Set(agentIds).size !== agentIds.length) {
    throw new Error('Group membership contains a duplicate member')
  }

  if (agentIds.length > 0) {
    const found = await executor
      .select({ id: schema.agents.id })
      .from(schema.agents)
      .where(inArray(schema.agents.id, agentIds))
    const known = new Set(found.map((a) => a.id))
    const missing = agentIds.filter((id) => !known.has(id))
    if (missing.length > 0) {
      throw new Error(`Unknown member agents: ${missing.join(', ')}`)
    }
  }

  return parsed
}

export function listGroups() {
  return db.select().from(schema.groups).orderBy(schema.groups.createdAt)
}

export async function getGroup(id: string) {
  const [group] = await db
    .select()
    .from(schema.groups)
    .where(eq(schema.groups.id, id))
    .limit(1)
  return group
}

/** The group's one shared conversation (unique on owner_group_id). */
export async function getGroupConversation(groupId: string) {
  const [conversation] = await db
    .select()
    .from(schema.conversations)
    .where(eq(schema.conversations.ownerGroupId, groupId))
    .limit(1)
  return conversation
}

/**
 * Creates the group together with its one shared conversation (titled after
 * the group) in one transaction, so a group never exists without its room and
 * the room pointer is never duplicated on the group row.
 */
export async function createGroup(input: GroupProfileInput) {
  const now = Date.now()
  return db.transaction(async (tx) => {
    const membersJson = await validateMembers(tx, input.members ?? [])
    const [group] = await tx
      .insert(schema.groups)
      .values({
        id: createId('grp'),
        name: input.name,
        description: input.description ?? '',
        membersJson,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
    const [conversation] = await tx
      .insert(schema.conversations)
      .values({
        id: createId('cnv'),
        ownerGroupId: group.id,
        title: group.name,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
    return { group, conversation }
  })
}

export async function updateGroupProfile(
  id: string,
  patch: Partial<Pick<GroupProfileInput, 'name' | 'description'>>,
) {
  const [updated] = await db
    .update(schema.groups)
    .set({ ...patch, updatedAt: Date.now() })
    .where(eq(schema.groups.id, id))
    .returning()
  return updated
}

/**
 * Replaces the versioned membership list. Adding, reordering, and removing
 * members all flow through this one setter; the stored order is the
 * orchestration order.
 */
export async function setGroupMembers(id: string, members: GroupMemberInput[]) {
  return db.transaction(async (tx) => {
    const membersJson = await validateMembers(tx, members)
    const [updated] = await tx
      .update(schema.groups)
      .set({ membersJson, updatedAt: Date.now() })
      .where(eq(schema.groups.id, id))
      .returning()
    if (!updated) throw new Error(`Group ${id} not found`)
    return updated
  })
}

/**
 * Deletes the group; its shared conversation (and that conversation's
 * messages, turns, and checkpoints) cascade in the database. The avatar file
 * is released afterwards if nothing else references it.
 */
export async function deleteGroup(id: string) {
  const existing = await getGroup(id)
  if (!existing) return false
  await db.delete(schema.groups).where(eq(schema.groups.id, id))
  if (existing.avatarFileId) {
    await deleteManagedFileIfUnreferenced(existing.avatarFileId)
  }
  return true
}

export async function setGroupAvatar(groupId: string, upload: AvatarUpload) {
  assertValidAvatarUpload(upload)
  const existing = await getGroup(groupId)
  if (!existing) throw new Error(`Group ${groupId} not found`)

  const file = await createManagedFile({
    bytes: upload.bytes,
    originalName: upload.originalName,
    mediaType: upload.mediaType,
    subdirectory: 'avatars',
  })

  const [updated] = await db
    .update(schema.groups)
    .set({ avatarFileId: file.id, updatedAt: Date.now() })
    .where(eq(schema.groups.id, groupId))
    .returning()
  if (!updated) {
    await deleteManagedFileIfUnreferenced(file.id)
    throw new Error(`Group ${groupId} not found`)
  }

  if (existing.avatarFileId && existing.avatarFileId !== file.id) {
    await deleteManagedFileIfUnreferenced(existing.avatarFileId)
  }
  return updated
}

export async function removeGroupAvatar(groupId: string) {
  const existing = await getGroup(groupId)
  if (!existing) throw new Error(`Group ${groupId} not found`)
  if (!existing.avatarFileId) return existing

  const [updated] = await db
    .update(schema.groups)
    .set({ avatarFileId: null, updatedAt: Date.now() })
    .where(eq(schema.groups.id, groupId))
    .returning()

  await deleteManagedFileIfUnreferenced(existing.avatarFileId)
  return updated ?? existing
}

export async function getGroupAvatarFile(groupId: string) {
  const group = await getGroup(groupId)
  if (!group?.avatarFileId) return undefined
  return readManagedFile(group.avatarFileId)
}
