import assert from 'node:assert/strict'
import test from 'node:test'
import { createDesktopClipboardController } from './desktop-clipboard'

type KeyCall = [keysym: number, code: string, down?: boolean]

function keyEvent(code: string, modifiers: { metaKey?: boolean; ctrlKey?: boolean } = {}) {
  let defaultPrevented = false
  let propagationStopped = false
  return {
    code,
    metaKey: modifiers.metaKey ?? false,
    ctrlKey: modifiers.ctrlKey ?? false,
    repeat: false,
    preventDefault: () => { defaultPrevented = true },
    stopPropagation: () => { propagationStopped = true },
    get defaultPrevented() { return defaultPrevented },
    get propagationStopped() { return propagationStopped },
  }
}

function setup(isMac = true) {
  const keys: KeyCall[] = []
  const pasted: string[] = []
  const copied: string[] = []
  const controller = createDesktopClipboardController({
    isMac,
    rfb: {
      sendKey: (...args) => keys.push(args),
      clipboardPasteFrom: (text) => pasted.push(text),
    },
    writeClipboard: async (text) => { copied.push(text) },
  })
  return { controller, keys, pasted, copied }
}

test('maps macOS Command+C to remote Control+C and copies remote text locally', async () => {
  const { controller, keys, copied } = setup()
  const commandDown = keyEvent('MetaLeft', { metaKey: true })
  const copy = keyEvent('KeyC', { metaKey: true })

  controller.keyDown(commandDown)
  controller.keyDown(copy)
  await controller.remoteClipboard('remote text')
  controller.keyUp(keyEvent('MetaLeft'))

  assert.deepEqual(keys, [
    [0xffe3, 'ControlLeft', true],
    [0x63, 'KeyC'],
    [0xffe3, 'ControlLeft', false],
  ])
  assert.deepEqual(copied, ['remote text'])
  assert.equal(copy.defaultPrevented, true)
  assert.equal(copy.propagationStopped, true)
})

test('transfers local text before sending macOS Command+V as remote Control+V', () => {
  const actions: Array<KeyCall | ['clipboard', string]> = []
  const controller = createDesktopClipboardController({
    isMac: true,
    rfb: {
      sendKey: (...args) => actions.push(args),
      clipboardPasteFrom: (text) => actions.push(['clipboard', text]),
    },
    writeClipboard: async () => {},
  })
  const pasteKey = keyEvent('KeyV', { metaKey: true })
  let pasteDefaultPrevented = false
  let pastePropagationStopped = false

  controller.keyDown(keyEvent('MetaLeft', { metaKey: true }))
  controller.keyDown(pasteKey)
  controller.paste({
    text: 'local text',
    preventDefault: () => { pasteDefaultPrevented = true },
    stopPropagation: () => { pastePropagationStopped = true },
  })
  controller.keyUp(keyEvent('MetaLeft'))

  assert.deepEqual(actions, [
    [0xffe3, 'ControlLeft', true],
    ['clipboard', 'local text'],
    [0x76, 'KeyV'],
    [0xffe3, 'ControlLeft', false],
  ])
  assert.equal(pasteKey.defaultPrevented, false)
  assert.equal(pasteKey.propagationStopped, true)
  assert.equal(pasteDefaultPrevented, true)
  assert.equal(pastePropagationStopped, true)
})

test('preserves noVNC macOS modifier behavior for other Command shortcuts', () => {
  const { controller, keys } = setup()
  const otherShortcut = keyEvent('KeyA', { metaKey: true })

  controller.keyDown(keyEvent('MetaLeft', { metaKey: true }))
  controller.keyDown(otherShortcut)
  controller.keyUp(keyEvent('MetaLeft'))

  assert.deepEqual(keys, [
    [0xffe9, 'AltLeft', true],
    [0xffe9, 'AltLeft', false],
  ])
  assert.equal(otherShortcut.defaultPrevented, false)
  assert.equal(otherShortcut.propagationStopped, false)
})

test('releases a synthetic modifier when the viewer loses focus', () => {
  const { controller, keys } = setup()

  controller.keyDown(keyEvent('MetaLeft', { metaKey: true }))
  controller.keyDown(keyEvent('KeyC', { metaKey: true }))
  controller.release()

  assert.deepEqual(keys.at(-1), [0xffe3, 'ControlLeft', false])
})

test('preserves noVNC modifier behavior for Command+click', () => {
  const { controller, keys } = setup()

  controller.keyDown(keyEvent('MetaRight', { metaKey: true }))
  controller.pointerDown()
  controller.keyUp(keyEvent('MetaRight'))

  assert.deepEqual(keys, [
    [0xffeb, 'MetaRight', true],
    [0xffeb, 'MetaRight', false],
  ])
})

test('restores the normal Command modifier before clicking after a copy shortcut', () => {
  const { controller, keys } = setup()

  controller.keyDown(keyEvent('MetaLeft', { metaKey: true }))
  controller.keyDown(keyEvent('KeyC', { metaKey: true }))
  controller.pointerDown()
  controller.keyUp(keyEvent('MetaLeft'))

  assert.deepEqual(keys.slice(-3), [
    [0xffe3, 'ControlLeft', false],
    [0xffe9, 'AltLeft', true],
    [0xffe9, 'AltLeft', false],
  ])
})

test('uses an existing remote Control modifier for Ctrl+V on other platforms', () => {
  const { controller, keys, pasted } = setup(false)
  const pasteKey = keyEvent('KeyV', { ctrlKey: true })

  controller.keyDown(pasteKey)
  controller.paste({ text: 'local text', preventDefault: () => {}, stopPropagation: () => {} })

  assert.deepEqual(keys, [[0x76, 'KeyV']])
  assert.deepEqual(pasted, ['local text'])
  assert.equal(pasteKey.defaultPrevented, false)
  assert.equal(pasteKey.propagationStopped, true)
})

test('does not overwrite the local clipboard for unsolicited remote changes', async () => {
  const { controller, copied } = setup()

  await controller.remoteClipboard('agent clipboard')

  assert.deepEqual(copied, [])
})

test('does not copy delayed remote clipboard data after focus is lost', async () => {
  const { controller, copied } = setup()

  controller.keyDown(keyEvent('MetaLeft', { metaKey: true }))
  controller.keyDown(keyEvent('KeyC', { metaKey: true }))
  controller.release()
  await controller.remoteClipboard('late clipboard')

  assert.deepEqual(copied, [])
})
