import { eq, inArray, max } from 'drizzle-orm'
import { assertValidAvatarUpload, type AvatarUpload } from './avatars'
import { db } from './client'
import type { DbExecutor } from './conversations'
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

export type AgentCreationOptions = {
  id?: string
  xDisplayNumber?: number
}

async function validateMcpAccountIds(executor: DbExecutor, accountIds: string[]) {
  if (new Set(accountIds).size !== accountIds.length) {
    throw new Error('MCP account grants contain a duplicate account')
  }
  if (accountIds.length === 0) return
  const found = await executor
    .select({ id: schema.mcpAccounts.id })
    .from(schema.mcpAccounts)
    .where(inArray(schema.mcpAccounts.id, accountIds))
  const known = new Set(found.map((account) => account.id))
  const missing = accountIds.filter((id) => !known.has(id))
  if (missing.length > 0) throw new Error(`Unknown MCP accounts: ${missing.join(', ')}`)
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

export async function getNextAgentXDisplayNumber(executor: DbExecutor = db) {
  const [result] = await executor
    .select({ highest: max(schema.agents.xDisplayNumber) })
    .from(schema.agents)
  return (result?.highest ?? 0) + 1
}

/** Caller must provide the transaction that makes this multi-row operation atomic. */
export async function createAgentInTransaction(
  executor: DbExecutor,
  input: AgentProfileInput,
  mcpAccountIds: string[] = [],
  options: AgentCreationOptions = {},
) {
  const now = Date.now()
  await validateMcpAccountIds(executor, mcpAccountIds)
  const [agent] = await executor
    .insert(schema.agents)
    .values({
      id: options.id ?? createId('agt'),
      xDisplayNumber: options.xDisplayNumber,
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
  const [conversation] = await executor
    .insert(schema.conversations)
    .values({
      id: createId('cnv'),
      ownerAgentId: agent.id,
      title: agent.name,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
  if (mcpAccountIds.length > 0) {
    await executor.insert(schema.agentMcpAccounts).values(
      mcpAccountIds.map((accountId) => ({
        agentId: agent.id,
        accountId,
        enabledAt: now,
      })),
    )
  }
  return { agent, conversation }
}

/**
 * Creates the agent together with its first conversation (titled after the
 * agent) in one transaction, so a new agent never exists without a room.
 */
export async function createAgent(input: AgentProfileInput, mcpAccountIds: string[] = []) {
  return db.transaction((tx) => createAgentInTransaction(tx, input, mcpAccountIds))
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

export async function updateAgentProfileAndMcpAccounts(
  id: string,
  patch: Partial<AgentProfileInput>,
  accountIds: string[],
) {
  return db.transaction(async (tx) => {
    await validateMcpAccountIds(tx, accountIds)
    const [updated] = await tx
      .update(schema.agents)
      .set({ ...patch, updatedAt: Date.now() })
      .where(eq(schema.agents.id, id))
      .returning()
    if (!updated) return undefined

    await tx.delete(schema.agentMcpAccounts).where(eq(schema.agentMcpAccounts.agentId, id))
    if (accountIds.length > 0) {
      const enabledAt = Date.now()
      await tx.insert(schema.agentMcpAccounts).values(
        accountIds.map((accountId) => ({ agentId: id, accountId, enabledAt })),
      )
    }
    return updated
  })
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
