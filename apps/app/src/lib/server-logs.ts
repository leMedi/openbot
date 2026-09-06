// Client-safe types and formatting shared by the server log capture and the
// settings dialog's live log view.

export type ServerLogLevel = 'debug' | 'info' | 'warn' | 'error'

export type ServerLogEntry = {
  id: number
  time: string
  level: ServerLogLevel
  message: string
}

export function formatServerLogs(entries: ServerLogEntry[]) {
  return entries.map((entry) => `${entry.time} ${entry.level.toUpperCase().padEnd(5)} ${entry.message}`).join('\n')
}
