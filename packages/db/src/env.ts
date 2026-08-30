import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { createEnv } from '@t3-oss/env-core'
import * as z from 'zod'

export const env = createEnv({
  server: {
    OPENBOT_DATA_DIR: z.string().trim().min(1),
  },
  runtimeEnvStrict: {
    OPENBOT_DATA_DIR: process.env.OPENBOT_DATA_DIR,
  },
  emptyStringAsUndefined: true,
})

function findWorkspaceRoot(start: string) {
  let directory = path.resolve(start)

  while (true) {
    if (existsSync(path.join(directory, 'pnpm-workspace.yaml'))) return directory

    const parent = path.dirname(directory)
    if (parent === directory) {
      throw new Error('Could not find the repository root')
    }
    directory = parent
  }
}

export const workspaceRoot = findWorkspaceRoot(process.cwd())
export const dataDirectory = path.resolve(workspaceRoot, env.OPENBOT_DATA_DIR)

mkdirSync(dataDirectory, { recursive: true })

export const databasePath = path.join(dataDirectory, 'store.db')
export const databaseUrl = `file:${databasePath}`
export const migrationsDirectory = path.join(workspaceRoot, 'packages/db/drizzle')

export const filesDirectory = path.join(dataDirectory, 'files')

mkdirSync(filesDirectory, { recursive: true })
