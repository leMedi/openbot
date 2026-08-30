import { createId, db, deleteManagedFileIfUnreferenced } from '@openbot/db'
import {
  agents,
  conversationMessages,
  conversations,
  groups,
  mcpServers,
  turns,
} from '@openbot/db/schema'
import { inArray, isNotNull } from 'drizzle-orm'
import { cleanTargets, type CleanTarget } from './targets'

export { cleanTargets }

export type CleanResult = Partial<Record<CleanTarget, number>>

export async function cleanData(targets: ReadonlySet<CleanTarget>) {
  const managedFileIds = new Set<string>()

  if (targets.has('bots')) {
    const avatars = await db
      .select({ fileId: agents.avatarFileId })
      .from(agents)
    for (const { fileId } of avatars) {
      if (fileId) managedFileIds.add(fileId)
    }
  }

  if (targets.has('bots') || targets.has('conversations')) {
    const messages = await db
      .select({ attachments: conversationMessages.attachmentsJson })
      .from(conversationMessages)
    for (const { attachments } of messages) {
      for (const { fileId } of attachments.items) managedFileIds.add(fileId)
    }
  }

  const result = await db.transaction(async (tx) => {
    const result: CleanResult = {}

    if (targets.has('conversations')) {
      await tx.update(conversations).set({ currentCheckpointId: null })
      const deleted = await tx
        .delete(conversations)
        .returning({ id: conversations.id })
      result.conversations = deleted.length

      const existingGroups = await tx.select({ id: groups.id }).from(groups)
      const now = Date.now()
      if (existingGroups.length > 0) {
        await tx.insert(conversations).values(
          existingGroups.map((group) => ({
            id: createId('cnv'),
            ownerGroupId: group.id,
            createdAt: now,
            updatedAt: now,
          })),
        )
      }
    }

    if (targets.has('bots')) {
      if (!targets.has('conversations')) {
        await tx
          .update(conversations)
          .set({ currentCheckpointId: null })
          .where(isNotNull(conversations.ownerAgentId))
      }

      const agentTurns = await tx
        .select({ id: turns.id })
        .from(turns)
        .where(isNotNull(turns.targetAgentId))
      if (agentTurns.length > 0) {
        await tx
          .update(conversationMessages)
          .set({ turnId: null })
          .where(inArray(
            conversationMessages.turnId,
            agentTurns.map((turn) => turn.id),
          ))
      }

      await tx
        .update(groups)
        .set({
          membersJson: { version: 1, members: [] },
          updatedAt: Date.now(),
        })

      const deleted = await tx.delete(agents).returning({ id: agents.id })
      result.bots = deleted.length
    }

    if (targets.has('mcps')) {
      const deleted = await tx
        .delete(mcpServers)
        .returning({ id: mcpServers.id })
      result.mcps = deleted.length
    }

    return result
  })

  for (const fileId of managedFileIds) {
    await deleteManagedFileIfUnreferenced(fileId)
  }

  return result
}
