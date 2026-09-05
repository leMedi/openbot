import { createFileRoute } from '@tanstack/react-router'
import { readInstalledVersion } from '@/server/version'

export const Route = createFileRoute('/api/server-version')({
  server: {
    handlers: {
      GET: async () => Response.json(
        { installedVersion: await readInstalledVersion() },
        { headers: { 'cache-control': 'no-store' } },
      ),
    },
  },
})
