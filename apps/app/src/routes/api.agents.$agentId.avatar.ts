import {
  getAgentAvatarFile,
  MAX_AVATAR_BYTES,
  removeAgentAvatar,
  setAgentAvatar,
} from '@openbot/db'
import { createFileRoute } from '@tanstack/react-router'

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : 'Avatar request failed'
  const status = /not found/i.test(message) ? 404 : 400
  return Response.json({ error: message }, { status })
}

async function readUpload(request: Request) {
  const contentType = request.headers.get('content-type') ?? ''
  if (!contentType.startsWith('multipart/form-data')) {
    throw new Error('Avatar uploads must be multipart/form-data with a "file" field')
  }

  const form = await request.formData()
  const file = form.get('file')
  if (!(file instanceof File)) {
    throw new Error('Expected a "file" form field with the avatar image')
  }
  if (file.size > MAX_AVATAR_BYTES) {
    throw new Error('Avatar upload exceeds the maximum size')
  }
  return {
    bytes: new Uint8Array(await file.arrayBuffer()),
    originalName: file.name || 'avatar',
    mediaType: file.type,
  }
}

// The single-user MVP has no authentication layer anywhere; this route shares
// the trust level of the server-function API boundary.
export const Route = createFileRoute('/api/agents/$agentId/avatar')({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const avatar = await getAgentAvatarFile(params.agentId)
        if (!avatar) {
          return Response.json({ error: 'Avatar not found' }, { status: 404 })
        }

        const etag = `"${avatar.file.id}"`
        if (request.headers.get('if-none-match') === etag) {
          return new Response(null, { status: 304, headers: { etag } })
        }

        return new Response(new Uint8Array(avatar.bytes), {
          headers: {
            'content-type': avatar.file.mediaType ?? 'application/octet-stream',
            'content-length': String(avatar.file.byteSize),
            'cache-control': 'private, max-age=3600',
            etag,
          },
        })
      },

      PUT: async ({ params, request }) => {
        try {
          const upload = await readUpload(request)
          const agent = await setAgentAvatar(params.agentId, upload)
          return Response.json(agent)
        } catch (error) {
          return errorResponse(error)
        }
      },

      DELETE: async ({ params }) => {
        try {
          const agent = await removeAgentAvatar(params.agentId)
          return Response.json(agent)
        } catch (error) {
          return errorResponse(error)
        }
      },
    },
  },
})
