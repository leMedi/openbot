type RfbClipboardClient = {
  sendKey: (keysym: number, code: string, down?: boolean) => void
  clipboardPasteFrom: (text: string) => void
}

type DesktopKeyEvent = {
  code: string
  metaKey: boolean
  ctrlKey: boolean
  repeat: boolean
  preventDefault: () => void
  stopPropagation: () => void
}

type DesktopPasteEvent = {
  text: string
  preventDefault: () => void
  stopPropagation: () => void
}

const keys = {
  altLeft: 0xffe9,
  controlLeft: 0xffe3,
  superLeft: 0xffeb,
  c: 0x63,
  v: 0x76,
} as const

type RemoteModifier = 'alt' | 'control' | 'super'

export function createDesktopClipboardController({
  isMac,
  rfb,
  writeClipboard,
}: {
  isMac: boolean
  rfb: RfbClipboardClient
  writeClipboard: (text: string) => Promise<void>
}) {
  let commandCode: 'MetaLeft' | 'MetaRight' | null = null
  let remoteModifier: RemoteModifier | null = null
  let copyRequestedAt: number | null = null
  let pasteRequested = false
  const interceptedKeys = new Set<string>()

  function sendModifier(modifier: RemoteModifier, down: boolean) {
    if (modifier === 'control') rfb.sendKey(keys.controlLeft, 'ControlLeft', down)
    else if (modifier === 'alt') rfb.sendKey(keys.altLeft, 'AltLeft', down)
    else rfb.sendKey(keys.superLeft, 'MetaRight', down)
  }

  function useRemoteModifier(modifier: RemoteModifier) {
    if (remoteModifier === modifier) return
    if (remoteModifier) sendModifier(remoteModifier, false)
    remoteModifier = modifier
    sendModifier(modifier, true)
  }

  function releaseRemoteModifier() {
    if (!remoteModifier) return
    sendModifier(remoteModifier, false)
    remoteModifier = null
  }

  function stop(event: DesktopKeyEvent, preventDefault = true) {
    event.stopPropagation()
    if (preventDefault) event.preventDefault()
  }

  function keyDown(event: DesktopKeyEvent) {
    const copyShortcut = event.code === 'KeyC'
    const pasteShortcut = event.code === 'KeyV'

    if (!isMac || (!commandCode && !event.metaKey)) {
      if (copyShortcut && event.ctrlKey) copyRequestedAt = Date.now()
      if (pasteShortcut && event.ctrlKey) {
        pasteRequested = true
        interceptedKeys.add(event.code)
        stop(event, false)
      }
      return
    }

    if (event.code === 'MetaLeft' || event.code === 'MetaRight') {
      commandCode = event.code
      stop(event)
      return
    }

    if (event.repeat && (copyShortcut || pasteShortcut)) {
      stop(event)
      return
    }

    if (copyShortcut) {
      useRemoteModifier('control')
      copyRequestedAt = Date.now()
      interceptedKeys.add(event.code)
      rfb.sendKey(keys.c, 'KeyC')
      stop(event)
      return
    }

    if (pasteShortcut) {
      useRemoteModifier('control')
      pasteRequested = true
      interceptedKeys.add(event.code)
      // Keep the browser's default so it emits a trusted paste event with clipboard data.
      stop(event, false)
      return
    }

    useRemoteModifier(commandCode === 'MetaRight' ? 'super' : 'alt')
  }

  function keyUp(event: DesktopKeyEvent) {
    if (event.code === 'MetaLeft' || event.code === 'MetaRight') {
      commandCode = null
      pasteRequested = false
      releaseRemoteModifier()
      stop(event)
      return
    }

    if (interceptedKeys.delete(event.code)) {
      if (event.code === 'KeyV') pasteRequested = false
      stop(event)
    }
  }

  function pointerDown() {
    if (!isMac || !commandCode) return
    useRemoteModifier(commandCode === 'MetaRight' ? 'super' : 'alt')
  }

  function paste(event: DesktopPasteEvent) {
    const modifierAlreadyDown = pasteRequested
    if (!modifierAlreadyDown) rfb.sendKey(keys.controlLeft, 'ControlLeft', true)
    rfb.clipboardPasteFrom(event.text)
    rfb.sendKey(keys.v, 'KeyV')
    if (!modifierAlreadyDown) rfb.sendKey(keys.controlLeft, 'ControlLeft', false)
    pasteRequested = false
    event.stopPropagation()
    event.preventDefault()
  }

  function cancelPaste() {
    pasteRequested = false
  }

  async function remoteClipboard(text: string) {
    const requestedAt = copyRequestedAt
    copyRequestedAt = null
    if (requestedAt === null || Date.now() - requestedAt > 5_000) return
    try {
      await writeClipboard(text)
    } catch {
      // Clipboard permissions vary by browser; the remote clipboard still remains valid.
    }
  }

  function release() {
    commandCode = null
    copyRequestedAt = null
    pasteRequested = false
    interceptedKeys.clear()
    releaseRemoteModifier()
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
  }
}
