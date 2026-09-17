// Client-safe types and formatting shared by the server log capture and the
// settings dialog's live log view.

import type { ServerLogEntry } from '@openbot/api'

export type { ServerLogEntry, ServerLogLevel } from '@openbot/api'

export function formatServerLogs(entries: ServerLogEntry[]) {
  return entries.map((entry) => `${entry.time} ${entry.level.toUpperCase().padEnd(5)} ${entry.message}`).join('\n')
}
