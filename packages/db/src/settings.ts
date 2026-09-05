import { eq } from 'drizzle-orm'
import { db } from './client'
import { setting } from './schema'

export const SETTING_ID = 1

/** Returns the one installation-wide settings row created by the migration. */
export async function getSetting() {
  const [current] = await db
    .select()
    .from(setting)
    .where(eq(setting.id, SETTING_ID))
    .limit(1)
  if (!current) throw new Error('Installation settings are missing')
  return current
}

export async function updateSettingModels(input: {
  defaultAgentModel: string
  orchestratorModel: string
}) {
  const [updated] = await db
    .update(setting)
    .set(input)
    .where(eq(setting.id, SETTING_ID))
    .returning()
  if (!updated) throw new Error('Installation settings are missing')
  return updated
}
