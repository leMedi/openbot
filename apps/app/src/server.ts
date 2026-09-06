import { createStartHandler, defaultStreamHandler } from '@tanstack/react-start/server'
import { installServerLogCapture } from '@/server/logs'

// Custom Start server entry: the default request handler, plus console
// capture installed before any route or server function runs so the settings
// dialog's live log view includes startup output.
installServerLogCapture()

export default { fetch: createStartHandler(defaultStreamHandler) }
