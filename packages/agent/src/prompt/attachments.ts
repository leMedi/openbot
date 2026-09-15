import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { readManagedFile, type ConversationMessage } from '@openbot/db'

export type PiPromptImage = { type: 'image'; data: string; mimeType: string }
export type StagedPromptAttachment = {
  fileId: string
  name: string
  mediaType: string
  path: string
}

function safeAttachmentName(name: string) {
  const basename = path.basename(name.trim())
  const sanitized = basename
    .replace(/[^A-Za-z0-9._ -]+/g, '_')
    .replace(/^\.+$/, '')
    .slice(0, 180)
  return sanitized || 'attachment'
}

/** Copies managed attachments into the agent-readable workspace. */
export async function stagePromptAttachments(
  rows: readonly ConversationMessage[],
  workspace: string,
) {
  const staged = new Map<string, string>()
  const attachments = rows.flatMap((row) => row.attachmentsJson.items)
  for (const attachment of attachments) {
    if (staged.has(attachment.fileId)) continue
    const result = await stageManagedPromptAttachment({
      fileId: attachment.fileId,
      workspace,
      name: typeof attachment.metadata.name === 'string'
        ? attachment.metadata.name
        : undefined,
    })
    if (result) staged.set(attachment.fileId, result.path)
  }
  return staged
}

async function writeStagedAttachment(input: {
  fileId: string
  name: string
  bytes: Uint8Array
  workspace: string
}) {
  const target = path.join(
    input.workspace,
    'uploads',
    input.fileId,
    safeAttachmentName(input.name),
  )
  await mkdir(path.dirname(target), { recursive: true })
  await writeFile(target, input.bytes)
  return target
}

async function stageManagedPromptAttachment(input: {
  fileId: string
  workspace: string
  name?: string
}): Promise<StagedPromptAttachment | undefined> {
  if (!/^[A-Za-z0-9_-]+$/.test(input.fileId)) return undefined
  const stored = await readManagedFile(input.fileId).catch(() => undefined)
  if (!stored) return undefined
  const name = input.name ?? stored.file.originalName
  const stagedPath = await writeStagedAttachment({
    fileId: input.fileId,
    name,
    bytes: stored.bytes,
    workspace: input.workspace,
  }).catch(() => undefined)
  if (!stagedPath) return undefined
  return {
    fileId: input.fileId,
    name,
    mediaType: stored.file.mediaType ?? 'application/octet-stream',
    path: stagedPath,
  }
}

/** Stages attachments when only durable file IDs are available (priority A2A). */
export async function stageManagedPromptAttachments(
  fileIds: readonly string[],
  workspace: string,
) {
  const staged: StagedPromptAttachment[] = []
  for (const fileId of new Set(fileIds)) {
    const result = await stageManagedPromptAttachment({
      fileId,
      workspace,
    })
    if (result) staged.push(result)
  }
  return staged
}

export function stagedAttachmentLine(attachment: StagedPromptAttachment) {
  return `- ${attachment.name} (${attachment.mediaType}, path: ${attachment.path})`
}

export function stagedAttachmentNote(attachments: readonly StagedPromptAttachment[]) {
  return attachments.length > 0
    ? ['[attachments]', ...attachments.map(stagedAttachmentLine)].join('\n')
    : ''
}

export function attachmentLines(
  message: ConversationMessage,
  stagedPaths: ReadonlyMap<string, string>,
) {
  return message.attachmentsJson.items.flatMap((item) => {
    const name = typeof item.metadata.name === 'string' ? item.metadata.name : 'attachment'
    const mediaType = typeof item.metadata.mediaType === 'string'
      ? item.metadata.mediaType
      : 'application/octet-stream'
    const stagedPath = stagedPaths.get(item.fileId)
    if (!stagedPath) return []
    return [stagedAttachmentLine({
      fileId: item.fileId,
      name,
      mediaType,
      path: stagedPath,
    })]
  })
}

async function loadManagedImage(fileId: string, maxBytes?: number) {
  const stored = await readManagedFile(fileId).catch(() => undefined)
  if (
    !stored ||
    !stored.file.mediaType?.startsWith('image/') ||
    (maxBytes !== undefined && stored.bytes.byteLength > maxBytes)
  ) return undefined
  return {
    type: 'image' as const,
    data: stored.bytes.toString('base64'),
    mimeType: stored.file.mediaType,
  }
}

export async function loadPromptImages(
  rows: readonly ConversationMessage[],
): Promise<PiPromptImage[]> {
  const images: PiPromptImage[] = []
  for (const row of rows) {
    for (const attachment of row.attachmentsJson.items) {
      const image = await loadManagedImage(attachment.fileId)
      if (image) images.push(image)
    }
  }
  return images
}

export async function loadManagedImages(fileIds: readonly string[]) {
  const loaded: PiPromptImage[] = []
  for (const fileId of fileIds) {
    const image = await loadManagedImage(fileId, 25 * 1024 * 1024)
    if (image) loaded.push(image)
  }
  return loaded
}
