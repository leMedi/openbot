import assert from 'node:assert/strict'
import test from 'node:test'
import { getDesktopMode, isAgentDesktopEnabled, isDesktopEnabled } from './mode'

test('defaults desktop mode to per-agent', () => {
  assert.equal(getDesktopMode({}), 'per-agent')
  assert.equal(getDesktopMode({ OPENBOT_DESKTOP_MODE: '  ' }), 'per-agent')
  assert.equal(isDesktopEnabled({}), true)
})

test('accepts supported desktop modes', () => {
  assert.equal(getDesktopMode({ OPENBOT_DESKTOP_MODE: 'per-agent' }), 'per-agent')
  assert.equal(getDesktopMode({ OPENBOT_DESKTOP_MODE: ' disabled ' }), 'disabled')
  assert.equal(isDesktopEnabled({ OPENBOT_DESKTOP_MODE: 'disabled' }), false)
})

test('requires both per-agent mode and an assigned display for agent desktop access', () => {
  assert.equal(isAgentDesktopEnabled(2, {}), true)
  assert.equal(isAgentDesktopEnabled(null, {}), false)
  assert.equal(isAgentDesktopEnabled(2, { OPENBOT_DESKTOP_MODE: 'disabled' }), false)
})

test('rejects unknown desktop modes', () => {
  assert.throws(
    () => getDesktopMode({ OPENBOT_DESKTOP_MODE: 'shared' }),
    /expected "disabled" or "per-agent"/,
  )
})
