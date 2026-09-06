export type DesktopLivenessCounters = {
  keys: number
  clicks: number
  moves: number
  drawOps: number
  inBytes: number
}

export type DesktopLivenessReport = {
  phase: 'post_connect'
  stallMs: number
  keys: number
  clicks: number
  moves: number
  inBytes: number
}

type LivenessDelta = DesktopLivenessCounters & { atMs: number }

const livenessWindowMs = 10_000
const minimumImpactfulInputs = 3

export function desktopReconnectDelay(attempt: number) {
  return Math.min(1_000 * 2 ** Math.max(0, attempt - 1), 10_000)
}

export function createDesktopLivenessDetector() {
  let last: DesktopLivenessCounters | null = null
  let samples: LivenessDelta[] = []
  let coveredSinceMs: number | null = null
  let episodeFired = false

  function reset() {
    last = null
    samples = []
    coveredSinceMs = null
    episodeFired = false
  }

  function rebaseline(nowMs: number, counters: DesktopLivenessCounters) {
    reset()
    last = counters
    coveredSinceMs = nowMs
  }

  function sample(nowMs: number, counters: DesktopLivenessCounters): DesktopLivenessReport | null {
    if (!last) {
      rebaseline(nowMs, counters)
      return null
    }
    const delta: LivenessDelta = {
      atMs: nowMs,
      keys: counters.keys - last.keys,
      clicks: counters.clicks - last.clicks,
      moves: counters.moves - last.moves,
      drawOps: counters.drawOps - last.drawOps,
      inBytes: counters.inBytes - last.inBytes,
    }
    if (delta.keys < 0 || delta.clicks < 0 || delta.moves < 0
      || delta.drawOps < 0 || delta.inBytes < 0) {
      rebaseline(nowMs, counters)
      return null
    }
    last = counters
    samples.push(delta)
    samples = samples.filter((entry) => entry.atMs > nowMs - livenessWindowMs)
    if (delta.drawOps > 0 || delta.inBytes > 0) episodeFired = false
    if (episodeFired || coveredSinceMs === null || nowMs - coveredSinceMs < livenessWindowMs) {
      return null
    }

    const totals = samples.reduce<DesktopLivenessCounters>((sum, entry) => ({
      keys: sum.keys + entry.keys,
      clicks: sum.clicks + entry.clicks,
      moves: sum.moves + entry.moves,
      drawOps: sum.drawOps + entry.drawOps,
      inBytes: sum.inBytes + entry.inBytes,
    }), { keys: 0, clicks: 0, moves: 0, drawOps: 0, inBytes: 0 })
    if (totals.keys + totals.clicks < minimumImpactfulInputs
      || totals.drawOps > 0 || totals.inBytes > 0) return null

    episodeFired = true
    const oldestInput = samples.find((entry) => entry.keys + entry.clicks > 0)
    return {
      phase: 'post_connect',
      stallMs: nowMs - (oldestInput?.atMs ?? nowMs),
      keys: totals.keys,
      clicks: totals.clicks,
      moves: totals.moves,
      inBytes: totals.inBytes,
    }
  }

  return { reset, sample }
}

type InstrumentableRfb = {
  _display?: { _damage?: (...args: number[]) => void }
  _sock?: { _websocket?: WebSocket | null }
}

// Grok instruments these noVNC internals too; keep the adapter isolated and pin noVNC 1.7.0.

function messageByteLength(data: unknown) {
  if (data instanceof ArrayBuffer) return data.byteLength
  if (ArrayBuffer.isView(data)) return data.byteLength
  if (typeof Blob !== 'undefined' && data instanceof Blob) return data.size
  return 0
}

export function instrumentDesktopLiveness({
  rfb,
  viewer,
  isConnected,
  onStall,
  onRecovery,
}: {
  rfb: object
  viewer: HTMLElement
  isConnected: () => boolean
  onStall: (report: DesktopLivenessReport) => void
  onRecovery: () => void
}): { connected: () => void; dispose: () => void } {
  const counters: DesktopLivenessCounters = {
    keys: 0,
    clicks: 0,
    moves: 0,
    drawOps: 0,
    inBytes: 0,
  }
  const detector = createDesktopLivenessDetector()
  let stalled = false

  const remoteActivity = () => {
    if (!stalled) return
    stalled = false
    onRecovery()
  }
  const onKeyDown = (event: KeyboardEvent) => {
    if (!event.repeat) counters.keys += 1
  }
  const onPointerDown = () => { counters.clicks += 1 }
  const onPointerMove = () => { counters.moves += 1 }
  const onMessage = (event: MessageEvent) => {
    counters.inBytes += messageByteLength(event.data)
    remoteActivity()
  }

  viewer.addEventListener('keydown', onKeyDown, true)
  viewer.addEventListener('pointerdown', onPointerDown, true)
  viewer.addEventListener('pointermove', onPointerMove, true)

  const internals = rfb as InstrumentableRfb
  const display = internals._display
  const originalDamage = display?._damage
  let wrappedDamage: ((...args: number[]) => void) | undefined
  if (display && originalDamage) {
    wrappedDamage = (...args) => {
      counters.drawOps += 1
      remoteActivity()
      originalDamage.apply(display, args)
    }
    display._damage = wrappedDamage
  }

  const socket = internals._sock?._websocket
  socket?.addEventListener('message', onMessage)
  const connected = () => {
    detector.reset()
    detector.sample(performance.now(), counters)
  }
  const timer = window.setInterval(() => {
    if (!isConnected()) return
    const report = detector.sample(performance.now(), counters)
    if (!report) return
    stalled = true
    onStall(report)
  }, 1_000)

  const dispose = () => {
    window.clearInterval(timer)
    viewer.removeEventListener('keydown', onKeyDown, true)
    viewer.removeEventListener('pointerdown', onPointerDown, true)
    viewer.removeEventListener('pointermove', onPointerMove, true)
    socket?.removeEventListener('message', onMessage)
    if (display && display._damage === wrappedDamage) display._damage = originalDamage
  }
  return { connected, dispose }
}
