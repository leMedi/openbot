import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { connect } from 'node:net'
import { Readable } from 'node:stream'
import { WebSocketServer } from 'ws'
import { getAgent } from '@openbot/db'
import app from '../dist/server/server.js'

const host = process.env.HOST ?? '127.0.0.1'
const port = Number(process.env.PORT ?? 3000)
const desktopMode = process.env.OPENBOT_DESKTOP_MODE?.trim() || 'per-agent'
if (desktopMode !== 'disabled' && desktopMode !== 'per-agent') {
  throw new Error(`Invalid OPENBOT_DESKTOP_MODE ${JSON.stringify(desktopMode)}; expected "disabled" or "per-agent"`)
}
const desktopEnabled = desktopMode === 'per-agent'
const vnc = desktopEnabled
  ? new WebSocketServer({ noServer: true, maxPayload: 8 * 1024 * 1024 })
  : undefined
const vncHeartbeat = vnc && setInterval(() => {
  for (const socket of vnc.clients) {
    if (socket.openbotAlive === false) {
      socket.terminate()
      continue
    }
    socket.openbotAlive = false
    socket.ping()
  }
}, 15_000)
vncHeartbeat?.unref()
const staticRoot = join(process.cwd(), 'dist/client')
const contentTypes = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff': 'font/woff', '.woff2': 'font/woff2' }

vnc?.on('connection', async (socket, _request, agentId) => {
  socket.openbotAlive = true
  socket.on('pong', () => { socket.openbotAlive = true })
  let agent
  try {
    agent = await getAgent(agentId)
  } catch {
    socket.close(1011, 'Could not resolve agent desktop')
    return
  }
  if (socket.readyState !== 1) return
  const display = agent?.xDisplayNumber
  if (display === null || display === undefined) {
    socket.close(1008, 'Agent desktop unavailable')
    return
  }
  const vncSocket = connect({ host: '127.0.0.1', port: 5900 + display })
  vncSocket.setKeepAlive(true, 15_000)
  socket.on('close', () => vncSocket.destroy())
  socket.on('error', () => vncSocket.destroy())
  vncSocket.on('connect', () => {
    if (socket.readyState !== 1) {
      vncSocket.destroy()
      return
    }
    socket.on('message', (data) => vncSocket.write(data))
  })
  vncSocket.on('data', (data) => {
    if (socket.readyState === 1) socket.send(data)
  })
  vncSocket.on('error', () => socket.close(1011, 'VNC connection failed'))
  vncSocket.on('close', () => socket.close())
})

vnc?.on('close', () => clearInterval(vncHeartbeat))

const server = createServer(async (request, response) => {
  const origin = request.headers.origin
  if (origin && origin !== process.env.OPENBOT_PUBLIC_URL) {
    response.writeHead(403).end('Forbidden')
    return
  }
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)
  if (request.method === 'GET' || request.method === 'HEAD') {
    const relative = normalize(decodeURIComponent(url.pathname)).replace(/^\/+/, '')
    const filePath = join(staticRoot, relative)
    if (filePath.startsWith(`${staticRoot}/`)) {
      try {
        const bytes = await readFile(filePath)
        response.writeHead(200, { 'content-type': contentTypes[extname(filePath)] ?? 'application/octet-stream' })
        if (request.method === 'HEAD') response.end()
        else response.end(bytes)
        return
      } catch { /* Let TanStack render application routes. */ }
    }
  }
  const hasBody = request.method !== 'GET' && request.method !== 'HEAD'
  const webRequest = new Request(url, {
    method: request.method,
    headers: request.headers,
    ...(hasBody ? { body: Readable.toWeb(request), duplex: 'half' } : {}),
  })
  const webResponse = await app.fetch(webRequest)
  response.writeHead(webResponse.status, Object.fromEntries(webResponse.headers))
  if (webResponse.body) Readable.fromWeb(webResponse.body).pipe(response)
  else response.end()
})

server.on('upgrade', (request, socket, head) => {
  const pathname = new URL(request.url ?? '/', 'http://localhost').pathname
  const match = /^\/api\/agents\/([^/]+)\/desktop\/vnc$/.exec(pathname)
  if (!vnc || !match || (request.headers.origin && request.headers.origin !== process.env.OPENBOT_PUBLIC_URL)) {
    socket.destroy()
    return
  }
  vnc.handleUpgrade(request, socket, head, (ws) =>
    vnc.emit('connection', ws, request, decodeURIComponent(match[1])),
  )
})

server.listen(port, host, () => console.log(`OpenBot listening on ${host}:${port}`))
