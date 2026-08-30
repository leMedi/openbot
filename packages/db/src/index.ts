import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { databaseUrl } from './env'
import * as schema from './schema'

const client = createClient({ url: databaseUrl })

export const db = drizzle(client, { schema })
export { agents } from './schema'
export type { Agent, NewAgent } from './schema'

export function listAgents() {
  return db.select().from(schema.agents).orderBy(schema.agents.id)
}

export async function createAgent(
  agent: Pick<schema.NewAgent, 'name' | 'description'>,
) {
  const [created] = await db.insert(schema.agents).values(agent).returning()
  return created
}
