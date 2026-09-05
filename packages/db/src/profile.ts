import { eq } from 'drizzle-orm'
import { db } from './client'
import { profile, type Profile } from './schema'

export const PROFILE_ID = 1

export type ProfileUpdate = Pick<
  Profile,
  'firstName' | 'lastName' | 'about' | 'timezone'
>

/** Returns the single local user's profile. */
export async function getProfile(): Promise<Profile> {
  const [current] = await db
    .select()
    .from(profile)
    .where(eq(profile.id, PROFILE_ID))
    .limit(1)
  if (!current) throw new Error('User profile is missing')
  return current
}

/** Replaces the editable fields on the single local user's profile. */
export async function updateProfile(input: ProfileUpdate): Promise<Profile> {
  const [updated] = await db
    .update(profile)
    .set({ ...input, updatedAt: Date.now() })
    .where(eq(profile.id, PROFILE_ID))
    .returning()
  if (!updated) throw new Error('User profile is missing')
  return updated
}
