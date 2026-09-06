import assert from 'node:assert/strict'
import test from 'node:test'
import { createDesktopClipboardController } from './desktop-clipboard'

type KeyCall = [keysym: number, code: string, down?: boolean]

function keyEvent(code: string, modifiers: {
  metaKey?: boolean
  ctrlKey?: boolean
  shiftKey?: boolean
  repeat?: boolean
} = {}) {
  let defaultPrevented = false
  let propagationStopped = false
  return {
    code,
    metaKey: modifiers.metaKey ?? false,
    ctrlKey: modifiers.ctrlKey ?? false,
    shiftKey: modifiers.shiftKey ?? false,
    altKey: false,
    repeat: modifiers.repeat ?? false,
    preventDefault: () => { defaultPrevented = true },
    stopPropagation: () => { propagationStopped = true },
    get defaultPrevented() { return defaultPrevented },
    get propagationStopped() { return propagationStopped },
  }
}

function setup(isMac = true, overrides: {
  readClipboard?: () => Promise<string>
  now?: () => number
} = {}) {
  const keys: KeyCall[] = []
  const pasted: string[] = []
  const copied: string[] = []
  const controller = createDesktopClipboardController({
    isMac,
    rfb: {
      sendKey: (...args) => keys.push(args),
      clipboardPasteFrom: (text) => { pasted.push(text) },
    },
    readClipboard: overrides.readClipboard,
    writeClipboard: async (text) => { copied.push(text) },
    now: overrides.now,
    schedulePaste: (callback) => {
      callback()
      return () => {}
    },
  })
  return { controller, keys, pasted, copied }
}

const releasedMacModifiers: KeyCall[] = [
  [0xffe7, 'MetaLeft', false],
  [0xffe8, 'MetaRight', false],
  [0xffe9, 'AltLeft', false],
  [0xffea, 'AltRight', false],
  [0xffeb, 'SuperLeft', false],
  [0xffec, 'SuperRight', false],
]

test('maps Grok macOS Command shortcuts to complete remote Control chords', () => {
  const cases = [
    ['KeyA', 0x61],
    ['KeyC', 0x63],
    ['KeyX', 0x78],
    ['KeyZ', 0x7a],
  ] as const

  for (const [code, keysym] of cases) {
    const { controller, keys } = setup()
    const event = keyEvent(code, { metaKey: true })
    controller.keyDown(event)

    assert.deepEqual(keys, [
      ...releasedMacModifiers,
      [0xffe3, 'ControlLeft', true],
      [keysym, code, true],
      [keysym, code, false],
      [0xffe3, 'ControlLeft', false],
    ])
    assert.equal(event.defaultPrevented, true)
    assert.equal(event.propagationStopped, true)
  }
})

test('includes Shift in a mapped macOS chord', () => {
  const { controller, keys } = setup()

  controller.keyDown(keyEvent('ShiftLeft', { shiftKey: true }))
  controller.keyDown(keyEvent('KeyZ', { metaKey: true, shiftKey: true }))

  assert.deepEqual(keys.slice(-5), [
    [0xffe3, 'ControlLeft', true],
    [0xffe1, 'ShiftLeft', true],
    [0x7a, 'KeyZ', true],
    [0x7a, 'KeyZ', false],
    [0xffe3, 'ControlLeft', false],
  ])
})

test('releases synthetic Shift when the physical key is no longer held', () => {
  let sendPaste: (() => void) | undefined
  const keys: KeyCall[] = []
  const controller = createDesktopClipboardController({
    isMac: true,
    rfb: { sendKey: (...args) => keys.push(args), clipboardPasteFrom: () => {} },
    writeClipboard: async () => {},
    schedulePaste: (callback) => {
      sendPaste = callback
      return () => { sendPaste = undefined }
    },
  })

  controller.keyDown(keyEvent('ShiftLeft', { shiftKey: true }))
  controller.keyDown(keyEvent('KeyV', { metaKey: true, shiftKey: true }))
  controller.paste({ text: 'text', preventDefault: () => {}, stopPropagation: () => {} })
  controller.keyUp(keyEvent('ShiftLeft'))
  sendPaste?.()

  assert.deepEqual(keys.slice(-6), [
    [0xffe3, 'ControlLeft', true],
    [0xffe1, 'ShiftLeft', true],
    [0x76, 'KeyV', true],
    [0x76, 'KeyV', false],
    [0xffe1, 'ShiftLeft', false],
    [0xffe3, 'ControlLeft', false],
  ])
})

test('uses the physical right Shift side without leaving left Shift stuck', () => {
  const { controller, keys } = setup()

  controller.keyDown(keyEvent('ShiftRight', { shiftKey: true }))
  controller.keyDown(keyEvent('KeyZ', { metaKey: true, shiftKey: true }))

  assert.deepEqual(keys.slice(-5), [
    [0xffe3, 'ControlLeft', true],
    [0xffe2, 'ShiftRight', true],
    [0x7a, 'KeyZ', true],
    [0x7a, 'KeyZ', false],
    [0xffe3, 'ControlLeft', false],
  ])
})

test('transfers local text before sending macOS Command+V as remote Control+V', () => {
  const actions: Array<KeyCall | ['clipboard', string]> = []
  const controller = createDesktopClipboardController({
    isMac: true,
    rfb: {
      sendKey: (...args) => actions.push(args),
      clipboardPasteFrom: (text) => { actions.push(['clipboard', text]) },
    },
    writeClipboard: async () => {},
    schedulePaste: (callback) => {
      callback()
      return () => {}
    },
  })
  const pasteKey = keyEvent('KeyV', { metaKey: true })

  controller.keyDown(pasteKey)
  controller.paste({ text: 'local text', preventDefault: () => {}, stopPropagation: () => {} })

  assert.deepEqual(actions, [
    ['clipboard', 'local text'],
    ...releasedMacModifiers,
    [0xffe3, 'ControlLeft', true],
    [0x76, 'KeyV', true],
    [0x76, 'KeyV', false],
    [0xffe3, 'ControlLeft', false],
  ])
  assert.equal(pasteKey.defaultPrevented, false)
  assert.equal(pasteKey.propagationStopped, true)
})

test('defers the paste chord until clipboard synchronization can reach the server', () => {
  const actions: Array<KeyCall | ['clipboard', string]> = []
  let sendPaste: (() => void) | undefined
  const controller = createDesktopClipboardController({
    isMac: true,
    rfb: {
      sendKey: (...args) => actions.push(args),
      clipboardPasteFrom: (text) => { actions.push(['clipboard', text]) },
    },
    writeClipboard: async () => {},
    schedulePaste: (callback) => {
      sendPaste = callback
      return () => { sendPaste = undefined }
    },
  })

  controller.keyDown(keyEvent('KeyV', { metaKey: true }))
  controller.paste({ text: 'local text', preventDefault: () => {}, stopPropagation: () => {} })
  assert.deepEqual(actions, [['clipboard', 'local text']])

  sendPaste?.()
  assert.equal(actions.length, 11)
})

test('leaves unrecognized macOS Command shortcuts to noVNC', () => {
  const { controller, keys } = setup()
  const event = keyEvent('KeyR', { metaKey: true })

  controller.keyDown(event)

  assert.deepEqual(keys, [])
  assert.equal(event.defaultPrevented, false)
  assert.equal(event.propagationStopped, false)
})

test('leaves Command shortcuts with Control or Option to noVNC', () => {
  const { controller, keys } = setup()
  const withControl = keyEvent('KeyC', { metaKey: true, ctrlKey: true })
  const withOption = { ...keyEvent('KeyC', { metaKey: true }), altKey: true }

  controller.keyDown(withControl)
  controller.keyDown(withOption)

  assert.deepEqual(keys, [])
  assert.equal(withControl.defaultPrevented, false)
  assert.equal(withOption.defaultPrevented, false)
})

test('ignores repeated mapped shortcuts', () => {
  const { controller, keys } = setup()
  const event = keyEvent('KeyC', { metaKey: true, repeat: true })

  controller.keyDown(event)

  assert.deepEqual(keys, [])
  assert.equal(event.defaultPrevented, true)
})

test('mirrors remote clipboard text while suppressing duplicates and echoes', async () => {
  let time = 1_000
  const { controller, copied } = setup(true, { now: () => time })

  await controller.remoteClipboard('remote text')
  await controller.remoteClipboard('remote text')
  controller.paste({ text: 'local text', preventDefault: () => {}, stopPropagation: () => {} })
  await controller.remoteClipboard('local text')
  time += 5_000
  await controller.remoteClipboard('remote text')

  assert.deepEqual(copied, ['remote text', 'remote text'])
})

test('retries a remote clipboard write after browser permission failure', async () => {
  let writes = 0
  const controller = createDesktopClipboardController({
    isMac: true,
    rfb: { sendKey: () => {}, clipboardPasteFrom: () => {} },
    writeClipboard: async () => {
      writes += 1
      if (writes === 1) throw new Error('denied')
    },
    schedulePaste: (callback) => {
      callback()
      return () => {}
    },
  })

  await controller.remoteClipboard('remote text')
  await controller.remoteClipboard('remote text')

  assert.equal(writes, 2)
})

test('syncs host clipboard to RFB on a throttled viewer gesture', async () => {
  let time = 1_000
  const { controller, pasted } = setup(true, {
    readClipboard: async () => 'host text',
    now: () => time,
  })

  await controller.pointerDown()
  time += 100
  await controller.pointerDown()
  time += 100
  await controller.syncHostClipboard()

  assert.deepEqual(pasted, ['host text', 'host text'])
})

test('ignores a stale host clipboard read that finishes after a newer read', async () => {
  let time = 1_000
  let resolveFirst: (text: string) => void = () => {}
  let resolveSecond: (text: string) => void = () => {}
  const reads = [
    new Promise<string>((resolve) => { resolveFirst = resolve }),
    new Promise<string>((resolve) => { resolveSecond = resolve }),
  ]
  const { controller, pasted } = setup(true, {
    readClipboard: async () => reads.shift() ?? '',
    now: () => time,
  })

  const first = controller.pointerDown()
  time += 200
  const second = controller.pointerDown()
  resolveSecond('newer')
  await second
  resolveFirst('older')
  await first

  assert.deepEqual(pasted, ['newer'])
})

test('serializes nonconsecutive remote clipboard updates', async () => {
  const writes: string[] = []
  let releaseFirst: () => void = () => {}
  const firstWrite = new Promise<void>((resolve) => { releaseFirst = resolve })
  const controller = createDesktopClipboardController({
    isMac: true,
    rfb: { sendKey: () => {}, clipboardPasteFrom: () => {} },
    writeClipboard: async (text) => {
      writes.push(text)
      if (text === 'first') await firstWrite
    },
  })

  const first = controller.remoteClipboard('first')
  const second = controller.remoteClipboard('second')
  const third = controller.remoteClipboard('first')
  await Promise.resolve()
  assert.deepEqual(writes, ['first'])
  releaseFirst()
  await Promise.all([first, second, third])

  assert.deepEqual(writes, ['first', 'second', 'first'])
})

test('does not start a queued remote clipboard write after release', async () => {
  const writes: string[] = []
  let releaseFirst: () => void = () => {}
  const firstWrite = new Promise<void>((resolve) => { releaseFirst = resolve })
  const controller = createDesktopClipboardController({
    isMac: true,
    rfb: { sendKey: () => {}, clipboardPasteFrom: () => {} },
    writeClipboard: async (text) => {
      writes.push(text)
      if (text === 'first') await firstWrite
    },
  })

  const first = controller.remoteClipboard('first')
  const second = controller.remoteClipboard('second')
  await Promise.resolve()
  controller.release()
  releaseFirst()
  await Promise.all([first, second])

  assert.deepEqual(writes, ['first'])
})

test('uses the existing remote Control modifier for Ctrl+V on other platforms', () => {
  const { controller, keys, pasted } = setup(false)
  const pasteKey = keyEvent('KeyV', { ctrlKey: true })

  controller.keyDown(pasteKey)
  controller.paste({ text: 'local text', preventDefault: () => {}, stopPropagation: () => {} })

  assert.deepEqual(keys, [
    [0xffe3, 'ControlLeft', true],
    [0x76, 'KeyV'],
    [0xffe3, 'ControlLeft', false],
  ])
  assert.deepEqual(pasted, ['local text'])
  assert.equal(pasteKey.defaultPrevented, false)
  assert.equal(pasteKey.propagationStopped, true)
})
