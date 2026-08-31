import { readManagedFile } from '@openbot/db'
import { createFileRoute } from '@tanstack/react-router'

// Serves managed files referenced by transcript attachments (agent-sent
// files). The single-user MVP has no authentication layer anywhere; this
// route shares the trust level of the server-function API boundary.
export const Route = createFileRoute('/api/files/$fileId')({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const managed = await readManagedFile(params.fileId)
        if (!managed) {
          return Response.json({ error: 'File not found' }, { status: 404 })
        }

        const etag = `"${managed.file.id}"`
        if (request.headers.get('if-none-match') === etag) {
          return new Response(null, { status: 304, headers: { etag } })
        }

        const filename = managed.file.originalName.replace(/[\r\n"\\]/g, '_')
        return new Response(new Uint8Array(managed.bytes), {
          headers: {
            'content-type': managed.file.mediaType ?? 'application/octet-stream',
            'content-length': String(managed.file.byteSize),
            'content-disposition': `inline; filename="${filename}"`,
            'cache-control': 'private, max-age=3600',
            etag,
          },
        })
      },
    },
  },
})
