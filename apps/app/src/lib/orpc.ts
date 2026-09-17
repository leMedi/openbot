import { router, type AppRouter } from '@openbot/api'
import { createORPCClient } from '@orpc/client'
import { RPCLink } from '@orpc/client/fetch'
import { ClientRetryPlugin, type ClientRetryPluginContext } from '@orpc/client/plugins'
import { createRouterClient, type RouterClient } from '@orpc/server'
import { createIsomorphicFn } from '@tanstack/react-start'

export interface ClientContext extends ClientRetryPluginContext {}

export type Api = RouterClient<AppRouter, ClientContext>

// One client for both worlds: route loaders running on the server call the
// procedures in-process (no HTTP hop), the browser talks to /api/rpc. Streams
// opt into EventSource-like reconnection per call with `context.retry`.
const getClient = createIsomorphicFn()
  .server((): Api => createRouterClient(router, { context: {} }))
  .client((): Api => {
    const link = new RPCLink<ClientContext>({
      url: () => `${window.location.origin}/api/rpc`,
      plugins: [new ClientRetryPlugin()],
    })
    return createORPCClient(link)
  })

export const orpc: Api = getClient()

/** Context that makes a stream reconnect forever, like `EventSource` does. */
export const RECONNECT_FOREVER: ClientContext = { retry: Number.POSITIVE_INFINITY }

type SubscribeHandlers<T> = {
  onEvent: (event: T) => void
  /** The stream is connected (also after each successful reconnect). */
  onOpen?: () => void
  /** The server ended the stream normally. */
  onEnd?: () => void
  /** The stream failed and will not be retried. */
  onError?: (error: unknown) => void
}

/**
 * Consumes a streaming procedure in the background and returns a function
 * that closes it. Mirrors `EventSource` so the components that used one keep
 * their shape: `open` receives the call options (signal + retry context).
 */
export function subscribe<T>(
  open: (options: { signal: AbortSignal; context: ClientContext }) => Promise<AsyncIterable<T>>,
  handlers: SubscribeHandlers<T>,
  context: ClientContext = RECONNECT_FOREVER,
): () => void {
  const controller = new AbortController()
  const { signal } = controller
  void (async () => {
    try {
      const iterator = await open({
        signal,
        context: {
          ...context,
          onRetry: (options) => {
            const cleanup = context.onRetry?.(options)
            return (succeeded) => {
              cleanup?.(succeeded)
              if (succeeded && !signal.aborted) handlers.onOpen?.()
            }
          },
        },
      })
      if (signal.aborted) return
      handlers.onOpen?.()
      for await (const event of iterator) {
        if (signal.aborted) return
        handlers.onEvent(event)
      }
      if (!signal.aborted) handlers.onEnd?.()
    } catch (error) {
      if (!signal.aborted) handlers.onError?.(error)
    }
  })()
  return () => controller.abort()
}
