import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { eq, sql } from 'drizzle-orm'
import { db } from './client'
import { filesDirectory } from './env'
import { createId } from './ids'
import * as schema from './schema'

const extensionByMediaType: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

export function extensionForMediaType(mediaType: string) {
  return extensionByMediaType[mediaType]
}

/**
 * Managed paths are stored relative to the application-owned files directory.
 * Anything that resolves outside it (absolute paths, `..` segments) is
 * rejected before touching the filesystem.
 */
export function resolveManagedFilePath(relativePath: string) {
  if (!relativePath || path.isAbsolute(relativePath) || relativePath.includes('\\')) {
    throw new Error(`Invalid managed file path: ${relativePath}`)
  }
  const resolved = path.resolve(filesDirectory, relativePath)
  const relation = path.relative(filesDirectory, resolved)
  if (relation === '' || relation.startsWith('..') || path.isAbsolute(relation)) {
    throw new Error(`Managed file path escapes the data directory: ${relativePath}`)
  }
  return resolved
}

export async function createManagedFile(input: {
  bytes: Uint8Array
  originalName: string
  mediaType: string
  subdirectory: string
}) {
  const extension = extensionForMediaType(input.mediaType)
  if (!extension) {
    throw new Error(`Unsupported media type: ${input.mediaType}`)
  }

  const id = createId('fil')
  const relativePath = path.posix.join(input.subdirectory, `${id}.${extension}`)
  const absolutePath = resolveManagedFilePath(relativePath)

  await mkdir(path.dirname(absolutePath), { recursive: true })
  await writeFile(absolutePath, input.bytes)

  try {
    const [created] = await db
      .insert(schema.managedFiles)
      .values({
        id,
        relativePath,
        originalName: input.originalName,
        mediaType: input.mediaType,
        byteSize: input.bytes.byteLength,
        createdAt: Date.now(),
      })
      .returning()
    return created
  } catch (error) {
    await unlink(absolutePath).catch(() => {})
    throw error
  }
}

export async function getManagedFile(id: string) {
  const [file] = await db
    .select()
    .from(schema.managedFiles)
    .where(eq(schema.managedFiles.id, id))
    .limit(1)
  return file
}

export async function readManagedFile(id: string) {
  const file = await getManagedFile(id)
  if (!file) return undefined
  const bytes = await readFile(resolveManagedFilePath(file.relativePath))
  return { file, bytes }
}

export async function isManagedFileReferenced(id: string) {
  const [agentReference] = await db
    .select({ id: schema.agents.id })
    .from(schema.agents)
    .where(eq(schema.agents.avatarFileId, id))
    .limit(1)
  if (agentReference) return true

  const [groupReference] = await db
    .select({ id: schema.groups.id })
    .from(schema.groups)
    .where(eq(schema.groups.avatarFileId, id))
    .limit(1)
  if (groupReference) return true

  const [attachmentReference] = await db
    .select({ id: schema.conversationMessages.id })
    .from(schema.conversationMessages)
    .where(
      sql`EXISTS (
        SELECT 1 FROM json_each(${schema.conversationMessages.attachmentsJson}, '$.items')
        WHERE json_extract(json_each.value, '$.fileId') = ${id}
      )`,
    )
    .limit(1)
  return !!attachmentReference
}

/**
 * Deletes the database row first and the disk file after; a crash in between
 * leaves an orphaned disk file, which the MVP explicitly accepts.
 */
export async function deleteManagedFileIfUnreferenced(id: string) {
  const file = await getManagedFile(id)
  if (!file) return false
  if (await isManagedFileReferenced(id)) return false

  await db.delete(schema.managedFiles).where(eq(schema.managedFiles.id, id))
  await unlink(resolveManagedFilePath(file.relativePath)).catch(() => {})
  return true
}
