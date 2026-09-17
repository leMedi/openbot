import type { AppRouter } from '@openbot/api'
import { createORPCClient } from '@orpc/client'
import { RPCLink } from '@orpc/client/fetch'
import { ClientRetryPlugin, type ClientRetryPluginContext } from '@orpc/client/plugins'
import type { RouterClient } from '@orpc/server'
import { createTanstackQueryUtils } from '@orpc/tanstack-query'
import { fetch as expoFetch } from 'expo/fetch'
import { getServerUrl } from '#/state/server'

// The type import above is erased at build time: no server code reaches the
// bundle. The router shape is the contract.
export interface ClientContext extends ClientRetryPluginContext {}

export type Api = RouterClient<AppRouter, ClientContext>

class NoServerError extends Error {
  constructor() {
    super('No OpenBot server configured')
    this.name = 'NoServerError'
  }
}

const link = new RPCLink<ClientContext>({
  url: () => {
    const origin = getServerUrl()
    if (!origin) throw new NoServerError()
    return `${origin}/api/rpc`
  },
  // Expo's fetch streams response bodies, which the event-iterator
  // procedures (turn output, routine events) need. RN's global fetch buffers.
  fetch: (request, init) =>
    expoFetch(request.url, {
      ...init,
      method: request.method,
      headers: request.headers,
      body: request.body,
      signal: request.signal,
    } as Parameters<typeof expoFetch>[1]) as unknown as Promise<Response>,
  plugins: [new ClientRetryPlugin()],
})

export const api: Api = createORPCClient(link)

/** TanStack Query helpers: `orpc.conversations.list.queryOptions()` etc. */
export const orpc = createTanstackQueryUtils(api)

/** Context that makes a stream reconnect forever, like `EventSource` does. */
export const RECONNECT_FOREVER: ClientContext = { retry: Number.POSITIVE_INFINITY }
