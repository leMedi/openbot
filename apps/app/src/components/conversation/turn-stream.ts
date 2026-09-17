// Client consumer for the turn stream procedure (messages.watchTurn).

import type { TurnStreamEvent } from '@openbot/agent'
import { orpc } from '@/lib/orpc'

export type { TurnStreamEvent }

/**
 * Consumes one turn's event stream until the server closes it. Resolves after
 * the terminal `done`/`error` event; rejects only on transport failures.
 * A dropped connection is retried a few times; the server replays persisted
 * rows on reattach and the consumer dedupes them by id.
 */
export async function streamTurn(
  turnId: string,
  onEvent: (event: TurnStreamEvent) => void,
): Promise<void> {
  const events = await orpc.messages.watchTurn({ turnId }, { context: { retry: 3 } })
  for await (const event of events) onEvent(event)
}
