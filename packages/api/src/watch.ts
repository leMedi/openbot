/**
 * Bridges the agent runtime's callback-style watchers (`watch(onEvent,
 * signal)` resolving when the watch ends) into the async iterator shape oRPC
 * streams as server-sent events. Aborting the consumer aborts the watcher.
 */
export async function* fromWatcher<T>(
  watch: (onEvent: (event: T) => void, signal: AbortSignal) => Promise<void>,
  signal?: AbortSignal,
): AsyncGenerator<T, void, undefined> {
  const controller = new AbortController()
  const abort = () => controller.abort()
  if (signal?.aborted) abort()
  else signal?.addEventListener('abort', abort, { once: true })

  const queue: T[] = []
  let finished = false
  let failure: unknown
  let wake: (() => void) | null = null
  const notify = () => {
    wake?.()
    wake = null
  }
  const watching = watch((event) => {
    queue.push(event)
    notify()
  }, controller.signal).then(
    () => { finished = true },
    (error: unknown) => { failure = error; finished = true },
  ).finally(notify)

  try {
    while (true) {
      if (queue.length > 0) {
        yield queue.shift()!
        continue
      }
      if (finished) {
        if (failure) throw failure
        return
      }
      await new Promise<void>((resolve) => { wake = resolve })
    }
  } finally {
    signal?.removeEventListener('abort', abort)
    controller.abort()
    await watching
  }
}
