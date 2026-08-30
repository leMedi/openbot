import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { migrate } from 'drizzle-orm/libsql/migrator'
import { databaseUrl, migrationsDirectory } from './env'
import { createId } from './ids'
import * as schema from './schema'

const client = createClient({ url: databaseUrl })

const db = drizzle(client, { schema })

await client.execute('PRAGMA foreign_keys = ON')
await client.execute('PRAGMA journal_mode = WAL')
await migrate(db, { migrationsFolder: migrationsDirectory })
await client.execute({
  sql: `UPDATE turns
    SET status = 'queued',
        attempt_count = attempt_count + 1,
        started_at = NULL,
        updated_at = ?
    WHERE status = 'running'`,
  args: [Date.now()],
})

export * from './ids'
export * from './json-schemas'
export { agents } from './schema'
export type { Agent, NewAgent } from './schema'

export function listAgents() {
  return db.select().from(schema.agents).orderBy(schema.agents.createdAt)
}

export async function createAgent(agent: { name: string; description: string }) {
  const now = Date.now()
  const [created] = await db
    .insert(schema.agents)
    .values({
      id: createId('agt'),
      name: agent.name,
      description: agent.description,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
  return created
}
