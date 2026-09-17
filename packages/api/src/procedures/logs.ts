import { withEventMeta } from '@orpc/server'
import * as z from 'zod'
import { base } from '../base'
import {
  installServerLogCapture,
  listServerLogs,
  type ServerLogEntry,
  subscribeServerLogs,
} from '../server-logs'
import { fromWatcher } from '../watch'

export const logs = {
  /**
   * Streams the server's recent console output: buffered history first, then
   * live entries. Each event carries the entry id, so a reconnecting client
   * resumes from `lastEventId`; `after` serves the same purpose on first
   * connect.
   */
  watch: base
    .input(z.object({ after: z.number().int().nonnegative().optional() }).optional())
    .handler(async function* ({ input, signal, lastEventId }) {
      installServerLogCapture()
      const afterId = Number(lastEventId ?? input?.after ?? 0) || 0
      const entries = fromWatcher<ServerLogEntry>((onEvent, watchSignal) => {
        for (const entry of listServerLogs(afterId)) onEvent(entry)
        const unsubscribe = subscribeServerLogs(onEvent)
        return new Promise<void>((resolve) => {
          watchSignal.addEventListener('abort', () => { unsubscribe(); resolve() }, { once: true })
        })
      }, signal)
      for await (const entry of entries) {
        yield withEventMeta(entry, { id: String(entry.id) })
      }
    }),
}
