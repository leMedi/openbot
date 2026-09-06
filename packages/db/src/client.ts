import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { migrate } from 'drizzle-orm/libsql/migrator'
import { databaseUrl, migrationsDirectory } from './env'
import * as schema from './schema'

const client = createClient({ url: databaseUrl })

export const db = drizzle(client, { schema })

await client.execute('PRAGMA foreign_keys = ON')
await client.execute('PRAGMA journal_mode = WAL')
await migrate(db, { migrationsFolder: migrationsDirectory })
const recoveryAt = Date.now()
await client.execute({
  sql: `UPDATE turns
    SET status = 'queued',
        attempt_count = attempt_count + 1,
        started_at = NULL,
        runtime_context_json = json_set(runtime_context_json, '$.restartRecoveryAt', ?),
        updated_at = ?
    WHERE status = 'running'`,
  args: [recoveryAt, recoveryAt],
})
