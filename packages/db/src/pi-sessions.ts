import { mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { dataDirectory } from './env'

function sessionPath(conversationId: string) {
  return path.join(dataDirectory, 'pi-sessions', conversationId)
}

/** Ensures and returns the Pi history directory for a private conversation. */
export async function piSessionDirectory(conversationId: string) {
  const directory = sessionPath(conversationId)
  await mkdir(directory, { recursive: true })
  return directory
}

/** Keeps a computer worker's model history isolated from its parent conversation. */
export async function computerUseWorkerSessionDirectory(
  conversationId: string,
  turnId: string,
) {
  const directory = path.join(sessionPath(conversationId), 'computer-use', turnId)
  await mkdir(directory, { recursive: true })
  return directory
}

/** Removes model history after its owning conversation has been deleted. */
export function deletePiSessionDirectory(conversationId: string) {
  return rm(sessionPath(conversationId), { recursive: true, force: true }).catch(() => {})
}

export function deletePiSessionDirectories(conversationIds: readonly string[]) {
  return Promise.all(conversationIds.map(deletePiSessionDirectory))
}
