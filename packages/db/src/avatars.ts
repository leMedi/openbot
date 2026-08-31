// Shared avatar-upload contract for every avatar owner (agents, groups).

export const AVATAR_MEDIA_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
] as const

export const MAX_AVATAR_BYTES = 5 * 1024 * 1024

export type AvatarUpload = {
  bytes: Uint8Array
  originalName: string
  mediaType: string
}

export function assertValidAvatarUpload(upload: AvatarUpload) {
  if (!(AVATAR_MEDIA_TYPES as readonly string[]).includes(upload.mediaType)) {
    throw new Error(`Unsupported avatar media type: ${upload.mediaType}`)
  }
  if (upload.bytes.byteLength === 0) {
    throw new Error('Avatar upload is empty')
  }
  if (upload.bytes.byteLength > MAX_AVATAR_BYTES) {
    throw new Error('Avatar upload exceeds the maximum size')
  }
}
