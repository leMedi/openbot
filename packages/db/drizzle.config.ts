import { defineConfig } from 'drizzle-kit'
import { databaseUrl } from './src/env'

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: databaseUrl,
  },
})
