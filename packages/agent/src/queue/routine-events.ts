import type { ConversationMessage } from '@openbot/db'

export type RoutineStreamEvent = {
  type: 'routine'
  phase: 'queued' | 'message' | 'settled'
  routineId: string
  turnId: string
  conversationId: string
  message?: ConversationMessage
}

const subscribers = new Set<(event: RoutineStreamEvent) => void>()

export function publishRoutineEvent(event: RoutineStreamEvent) {
  for (const subscriber of subscribers) subscriber(event)
}

export function watchRoutineEvents(
  onEvent: (event: RoutineStreamEvent) => void,
  signal?: AbortSignal,
) {
  subscribers.add(onEvent)
  return new Promise<void>((resolve) => {
    const close = () => {
      subscribers.delete(onEvent)
      signal?.removeEventListener('abort', close)
      resolve()
    }
    if (signal?.aborted) close()
    else signal?.addEventListener('abort', close, { once: true })
  })
}
