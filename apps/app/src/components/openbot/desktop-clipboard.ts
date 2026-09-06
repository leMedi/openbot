type RfbClipboardClient = {
  sendKey: (keysym: number, code: string, down?: boolean) => void
  clipboardPasteFrom: (text: string) => void | Promise<void>
}

type DesktopKeyEvent = {
  code: string
  metaKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
  repeat: boolean
  altKey: boolean
  preventDefault: () => void
  stopPropagation: () => void
}

type DesktopPasteEvent = {
  text: string
  preventDefault: () => void
  stopPropagation: () => void
}

const keys = {
  controlLeft: 0xffe3,
  shiftLeft: 0xffe1,
  shiftRight: 0xffe2,
  v: 0x76,
} as const

const macShortcutKeysyms: Record<string, number> = {
  KeyA: 0x61,
  KeyC: 0x63,
  KeyV: 0x76,
  KeyX: 0x78,
  KeyZ: 0x7a,
}

const macRemoteModifiers: ReadonlyArray<readonly [number, string]> = [
  [0xffe7, 'MetaLeft'],
  [0xffe8, 'MetaRight'],
  [0xffe9, 'AltLeft'],
  [0xffea, 'AltRight'],
  [0xffeb, 'SuperLeft'],
  [0xffec, 'SuperRight'],
]

export function createDesktopClipboardController({
  isMac,
  rfb,
  readClipboard,
  writeClipboard,
  onClipboardAccess,
  onRemoteClipboard,
  now = Date.now,
  schedulePaste = (callback) => {
    const timer = globalThis.setTimeout(callback, 100)
    return () => globalThis.clearTimeout(timer)
  },
}: {
  isMac: boolean
  rfb: RfbClipboardClient
  readClipboard?: () => Promise<string>
  writeClipboard: (text: string) => Promise<void>
  onClipboardAccess?: (available: boolean) => void
  onRemoteClipboard?: (text: string) => void
  now?: () => number
  schedulePaste?: (callback: () => void) => () => void
}) {
  let pasteRequested = false
  let pasteShifted = false
  let lastHostTextSentToRemote: { text: string; at: number } | null = null
  let lastRemoteTextSentToHost: { text: string; at: number } | null = null
  let hostReadGeneration = 0
  let sessionGeneration = 0
  let remoteWriteQueue = Promise.resolve()
  let lastQueuedRemoteWrite: { id: number; text: string } | null = null
  let remoteWriteId = 0
  let lastClipboardReadAt = Number.NEGATIVE_INFINITY
  let cancelScheduledPaste: (() => void) | null = null
  const interceptedKeys = new Set<string>()
  const heldShiftCodes = new Set<string>()

  function stop(event: DesktopKeyEvent, preventDefault = true) {
    event.stopPropagation()
    if (preventDefault) event.preventDefault()
  }

  function sendMacShortcut(code: string, keysym: number, shifted: boolean) {
    const shiftCode = heldShiftCodes.has('ShiftRight') && !heldShiftCodes.has('ShiftLeft')
      ? 'ShiftRight'
      : 'ShiftLeft'
    const shiftKeysym = shiftCode === 'ShiftRight' ? keys.shiftRight : keys.shiftLeft
    for (const [modifierKeysym, modifierCode] of macRemoteModifiers) {
      rfb.sendKey(modifierKeysym, modifierCode, false)
    }
    rfb.sendKey(keys.controlLeft, 'ControlLeft', true)
    if (shifted) rfb.sendKey(shiftKeysym, shiftCode, true)
    rfb.sendKey(keysym, code, true)
    rfb.sendKey(keysym, code, false)
    if (shifted && heldShiftCodes.size === 0) rfb.sendKey(shiftKeysym, shiftCode, false)
    rfb.sendKey(keys.controlLeft, 'ControlLeft', false)
  }

  function keyDown(event: DesktopKeyEvent) {
    if (event.code === 'ShiftLeft' || event.code === 'ShiftRight') heldShiftCodes.add(event.code)
    if (!isMac || !event.metaKey || event.ctrlKey || event.altKey) {
      if (event.code === 'KeyV' && event.ctrlKey) {
        pasteRequested = true
        pasteShifted = event.shiftKey
        interceptedKeys.add(event.code)
        // Keep the browser default so a trusted paste event exposes clipboard data.
        stop(event, false)
      }
      return
    }

    const keysym = macShortcutKeysyms[event.code]
    if (keysym === undefined) return
    stop(event, event.code !== 'KeyV')
    if (event.repeat) return
    interceptedKeys.add(event.code)

    if (event.code === 'KeyV') {
      pasteRequested = true
      pasteShifted = event.shiftKey
      return
    }

    sendMacShortcut(event.code, keysym, event.shiftKey)
  }

  function keyUp(event: DesktopKeyEvent) {
    if (event.code === 'ShiftLeft' || event.code === 'ShiftRight') heldShiftCodes.delete(event.code)
    if (!interceptedKeys.delete(event.code)) return
    if (event.code === 'KeyV') pasteRequested = false
    stop(event)
  }

  async function syncHostClipboard() {
    if (!readClipboard) return
    const readAt = now()
    if (readAt - lastClipboardReadAt < 200) return
    lastClipboardReadAt = readAt
    const generation = ++hostReadGeneration
    try {
      const text = await readClipboard()
      if (generation !== hostReadGeneration) return
      onClipboardAccess?.(true)
      if (!text) return
      await rfb.clipboardPasteFrom(text)
      lastHostTextSentToRemote = { text, at: now() }
    } catch {
      if (generation === hostReadGeneration) onClipboardAccess?.(false)
      // Browser clipboard reads depend on permissions and a user gesture.
    }
  }

  function pointerDown() {
    return syncHostClipboard()
  }

  function paste(event: DesktopPasteEvent) {
    const clipboardTransfer = rfb.clipboardPasteFrom(event.text)
    onClipboardAccess?.(true)
    lastHostTextSentToRemote = { text: event.text, at: now() }
    const useMacMapping = pasteRequested && isMac
    const shifted = pasteShifted
    const pasteGeneration = ++sessionGeneration
    const sendPaste = () => {
      if (pasteGeneration !== sessionGeneration) return
      cancelScheduledPaste?.()
      cancelScheduledPaste = schedulePaste(() => {
        cancelScheduledPaste = null
        if (useMacMapping) sendMacShortcut('KeyV', keys.v, shifted)
        else {
          rfb.sendKey(keys.controlLeft, 'ControlLeft', true)
          rfb.sendKey(keys.v, 'KeyV')
          rfb.sendKey(keys.controlLeft, 'ControlLeft', false)
        }
      })
    }
    if (clipboardTransfer instanceof Promise) void clipboardTransfer.then(sendPaste, sendPaste)
    else sendPaste()
    pasteRequested = false
    pasteShifted = false
    event.stopPropagation()
    event.preventDefault()
  }

  function cancelPaste() {
    pasteRequested = false
    pasteShifted = false
  }

  async function remoteClipboard(text: string) {
    const receivedAt = now()
    if (!text || lastQueuedRemoteWrite?.text === text
      || lastHostTextSentToRemote?.text === text
        && receivedAt - lastHostTextSentToRemote.at < 5_000
      || lastRemoteTextSentToHost?.text === text
        && receivedAt - lastRemoteTextSentToHost.at < 5_000) return
    const queuedWrite = { id: ++remoteWriteId, text }
    const generation = sessionGeneration
    lastQueuedRemoteWrite = queuedWrite
    onRemoteClipboard?.(text)
    const write = remoteWriteQueue.then(async () => {
      if (generation !== sessionGeneration) return
      try {
        await writeClipboard(text)
        if (generation !== sessionGeneration) return
        lastRemoteTextSentToHost = { text, at: now() }
        onClipboardAccess?.(true)
      } catch {
        if (generation === sessionGeneration) onClipboardAccess?.(false)
        // Browser clipboard writes can still be denied while the RFB clipboard remains valid.
      } finally {
        if (lastQueuedRemoteWrite?.id === queuedWrite.id) lastQueuedRemoteWrite = null
      }
    })
    remoteWriteQueue = write
    await write
  }

  function release() {
    hostReadGeneration += 1
    sessionGeneration += 1
    lastQueuedRemoteWrite = null
    cancelScheduledPaste?.()
    cancelScheduledPaste = null
    pasteRequested = false
    pasteShifted = false
    interceptedKeys.clear()
    heldShiftCodes.clear()
  }

  return {
    cancelPaste,
    hasPendingPaste: () => pasteRequested,
    keyDown,
    keyUp,
    paste,
    pointerDown,
    release,
    remoteClipboard,
    syncHostClipboard,
  }
}
