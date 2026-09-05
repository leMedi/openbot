import assert from 'node:assert/strict'
import test from 'node:test'
import type { DesktopExecutorDependencies } from './executor'
import { executeComputerUse } from './executor'

function fakeWebP(width = 1280, height = 800) {
  const payload = Buffer.alloc(10)
  payload.writeUIntLE(width - 1, 4, 3)
  payload.writeUIntLE(height - 1, 7, 3)
  const size = Buffer.alloc(4)
  size.writeUInt32LE(payload.length)
  const riffSize = Buffer.alloc(4)
  riffSize.writeUInt32LE(4 + 8 + payload.length)
  return Buffer.concat([
    Buffer.from('RIFF'),
    riffSize,
    Buffer.from('WEBPVP8X'),
    size,
    payload,
  ])
}

const webp = fakeWebP()

function fakeDependencies() {
  const commands: Array<{ command: string; arguments: readonly string[] }> = []
  const waits: number[] = []
  let now = 100
  const dependencies: DesktopExecutorDependencies = {
    now: () => now,
    wait: async (durationMs) => {
      waits.push(durationMs)
      now += durationMs
    },
    run: async (command, arguments_) => {
      commands.push({ command, arguments: arguments_ })
      if (command === 'import') return { stdout: webp, stderr: '' }
      if (arguments_[0] === 'getdisplaygeometry') {
        return { stdout: Buffer.from('1280 800\n'), stderr: '' }
      }
      if (arguments_[0] === 'getmouselocation') {
        return { stdout: Buffer.from('X=12\nY=34\nSCREEN=0\nWINDOW=1\n'), stderr: '' }
      }
      return { stdout: Buffer.alloc(0), stderr: '' }
    },
  }
  return { commands, waits, dependencies }
}

test('executes protobuf-shaped actions and returns the last screenshot', async () => {
  const fake = fakeDependencies()
  const result = await executeComputerUse(
    {
      tool_call_id: 'tool-1',
      actions: [
        { mouse_move: { coordinate: { x: 10, y: 20 } } },
        {
          click: {
            button: 'MOUSE_BUTTON_LEFT',
            count: 2,
            modifier_keys: 'CTRL+SHIFT',
          },
        },
        { wait: { duration_ms: 25 } },
        { screenshot: {} },
        { cursor_position: {} },
      ],
    },
    fake.dependencies,
  )

  assert.ok('success' in result)
  assert.equal(result.success.action_count, 5)
  assert.equal(result.success.duration_ms, 25)
  assert.equal(result.success.screenshot, webp.toString('base64'))
  assert.deepEqual(result.success.cursor_position, { x: 12, y: 34 })
  assert.deepEqual(fake.waits, [25])
  assert.deepEqual(fake.commands.slice(0, 7), [
    { command: 'xdotool', arguments: ['getdisplaygeometry'] },
    { command: 'xdotool', arguments: ['mousemove', '--sync', '10', '20'] },
    { command: 'xdotool', arguments: ['keydown', 'ctrl'] },
    { command: 'xdotool', arguments: ['keydown', 'shift'] },
    {
      command: 'xdotool',
      arguments: ['click', '--repeat', '2', '--delay', '80', '1'],
    },
    { command: 'xdotool', arguments: ['keyup', 'shift'] },
    { command: 'xdotool', arguments: ['keyup', 'ctrl'] },
  ])
})

test('validates every action before executing the sequence', async () => {
  const fake = fakeDependencies()
  const result = await executeComputerUse(
    {
      tool_call_id: 'tool-2',
      actions: [
        { wait: { duration_ms: 5 } },
        { mouse_move: { coordinate: { x: 1280, y: 0 } } },
      ],
    },
    fake.dependencies,
  )

  assert.ok('error' in result)
  assert.equal(result.error.action_count, 0)
  assert.match(result.error.error, /mouse_move\.coordinate\.x/)
  assert.deepEqual(fake.waits, [])
  assert.deepEqual(fake.commands, [])
})

test('releases a held mouse button when a drag movement fails', async () => {
  const fake = fakeDependencies()
  fake.dependencies.run = async (command, arguments_) => {
    fake.commands.push({ command, arguments: arguments_ })
    if (arguments_[0] === 'getdisplaygeometry') {
      return { stdout: Buffer.from('1280 800\n'), stderr: '' }
    }
    if (arguments_[0] === 'mousemove' && arguments_[2] === '30') throw new Error('move failed')
    return { stdout: Buffer.alloc(0), stderr: '' }
  }
  const result = await executeComputerUse(
    {
      tool_call_id: 'tool-3',
      actions: [
        {
          drag: {
            path: [
              { x: 10, y: 20 },
              { x: 30, y: 40 },
            ],
            button: 'MOUSE_BUTTON_LEFT',
          },
        },
      ],
    },
    fake.dependencies,
  )

  assert.ok('error' in result)
  assert.ok(
    fake.commands.some(
      ({ command, arguments: arguments_ }) =>
        command === 'xdotool' && arguments_[0] === 'mouseup' && arguments_[1] === '1',
    ),
  )
})

test('rejects and releases an unmatched mouse-down action', async () => {
  const fake = fakeDependencies()
  const result = await executeComputerUse(
    {
      tool_call_id: 'tool-4',
      actions: [{ mouse_down: { button: 'MOUSE_BUTTON_LEFT' } }],
    },
    fake.dependencies,
  )

  assert.ok('error' in result)
  assert.match(result.error.error, /matching mouse_up/)
  assert.deepEqual(fake.commands, [])
})

test('normalizes common key names without lowercasing X keysyms', async () => {
  const fake = fakeDependencies()
  const result = await executeComputerUse(
    {
      tool_call_id: 'tool-5',
      actions: [{ key: { key: 'CTRL+F1' } }, { screenshot: {} }],
    },
    fake.dependencies,
  )

  assert.ok('success' in result)
  assert.deepEqual(fake.commands[1], {
    command: 'xdotool',
    arguments: ['key', '--clearmodifiers', 'ctrl+F1'],
  })
})

test('normalizes uppercase single-letter key combinations without implying shift', async () => {
  const fake = fakeDependencies()
  const result = await executeComputerUse(
    {
      tool_call_id: 'tool-5b',
      actions: [{ key: { key: 'CTRL+A' } }, { screenshot: {} }],
    },
    fake.dependencies,
  )

  assert.ok('success' in result)
  assert.deepEqual(fake.commands[1], {
    command: 'xdotool',
    arguments: ['key', '--clearmodifiers', 'ctrl+a'],
  })
})

test('requires the binding flag only for characters absent from the keymap', async () => {
  const withoutBinding = fakeDependencies()
  const rejected = await executeComputerUse(
    {
      tool_call_id: 'tool-6',
      actions: [{ type: { text: 'héllo' } }],
    },
    withoutBinding.dependencies,
  )
  assert.ok('error' in rejected)
  assert.match(rejected.error.error, /bind_unmapped_characters/)

  const mapped = fakeDependencies()
  mapped.dependencies.run = async (command, arguments_) => {
    mapped.commands.push({ command, arguments: arguments_ })
    if (arguments_[0] === 'getdisplaygeometry') {
      return { stdout: Buffer.from('1280 800\n'), stderr: '' }
    }
    if (command === 'xmodmap') {
      return {
        stdout: Buffer.from('0x0068 0x00e9 0x006c 0x006f\n'),
        stderr: '',
      }
    }
    if (command === 'import') return { stdout: webp, stderr: '' }
    return { stdout: Buffer.alloc(0), stderr: '' }
  }
  const mappedResult = await executeComputerUse(
    {
      tool_call_id: 'tool-6b',
      actions: [{ type: { text: 'héllo' } }, { screenshot: {} }],
    },
    mapped.dependencies,
  )
  assert.ok('success' in mappedResult)

  const withBinding = fakeDependencies()
  const accepted = await executeComputerUse(
    {
      tool_call_id: 'tool-7',
      bind_unmapped_characters: true,
      actions: [{ type: { text: 'héllo' } }, { screenshot: {} }],
    },
    withBinding.dependencies,
  )
  assert.ok('success' in accepted)
})

test('automatically captures a screenshot after mutating actions', async () => {
  const fake = fakeDependencies()
  const result = await executeComputerUse(
    {
      tool_call_id: 'tool-8',
      actions: [{ key: { key: 'Tab' } }],
    },
    fake.dependencies,
  )

  assert.ok('success' in result)
  assert.equal(result.success.screenshot, webp.toString('base64'))
  assert.equal(result.success.action_count, 1)
  assert.ok(fake.commands.some(({ command }) => command === 'import'))
  assert.deepEqual(result.success.cursor_position, { x: 12, y: 34 })
})

test('captures again when a wait follows an explicit mutation screenshot', async () => {
  const fake = fakeDependencies()
  const result = await executeComputerUse(
    {
      tool_call_id: 'tool-8b',
      actions: [
        { key: { key: 'Tab' } },
        { screenshot: {} },
        { wait: { duration_ms: 1 } },
      ],
    },
    fake.dependencies,
  )

  assert.ok('success' in result)
  assert.equal(fake.commands.filter(({ command }) => command === 'import').length, 2)
})

test('rejects more than ten actions', async () => {
  const fake = fakeDependencies()
  const result = await executeComputerUse(
    {
      tool_call_id: 'tool-8c',
      actions: Array.from({ length: 11 }, () => ({ wait: { duration_ms: 0 } })),
    },
    fake.dependencies,
  )

  assert.ok('error' in result)
  assert.match(result.error.error, /between 1 and 10/)
})

test('rejects a live display with unexpected dimensions', async () => {
  const fake = fakeDependencies()
  fake.dependencies.run = async (command, arguments_) => {
    fake.commands.push({ command, arguments: arguments_ })
    return { stdout: Buffer.from('1024 768\n'), stderr: '' }
  }
  const result = await executeComputerUse(
    { tool_call_id: 'tool-9', actions: [{ wait: { duration_ms: 0 } }] },
    fake.dependencies,
  )

  assert.ok('error' in result)
  assert.match(result.error.error, /1024×768/)
})

test('captures the resulting desktop when a mutating sequence fails', async () => {
  const fake = fakeDependencies()
  let keyCount = 0
  fake.dependencies.run = async (command, arguments_) => {
    fake.commands.push({ command, arguments: arguments_ })
    if (arguments_[0] === 'getdisplaygeometry') {
      return { stdout: Buffer.from('1280 800\n'), stderr: '' }
    }
    if (command === 'import') return { stdout: webp, stderr: '' }
    if (arguments_[0] === 'key' && ++keyCount === 2) throw new Error('second key failed')
    return { stdout: Buffer.alloc(0), stderr: '' }
  }
  const result = await executeComputerUse(
    {
      tool_call_id: 'tool-10',
      actions: [{ key: { key: 'Tab' } }, { key: { key: 'Escape' } }],
    },
    fake.dependencies,
  )

  assert.ok('error' in result)
  assert.equal(result.error.action_count, 1)
  assert.equal(result.error.screenshot, webp.toString('base64'))
})

test('releases every modifier when a later key-down fails', async () => {
  const fake = fakeDependencies()
  fake.dependencies.run = async (command, arguments_) => {
    fake.commands.push({ command, arguments: arguments_ })
    if (arguments_[0] === 'getdisplaygeometry') {
      return { stdout: Buffer.from('1280 800\n'), stderr: '' }
    }
    if (command === 'import') return { stdout: webp, stderr: '' }
    if (arguments_[0] === 'keydown' && arguments_[1] === 'shift') {
      throw new Error('shift key-down failed')
    }
    return { stdout: Buffer.alloc(0), stderr: '' }
  }
  const result = await executeComputerUse(
    {
      tool_call_id: 'tool-11',
      actions: [
        {
          click: {
            button: 'MOUSE_BUTTON_LEFT',
            count: 1,
            modifier_keys: 'CTRL+SHIFT',
          },
        },
      ],
    },
    fake.dependencies,
  )

  assert.ok('error' in result)
  assert.ok(
    fake.commands.some(
      ({ arguments: arguments_ }) => arguments_[0] === 'keyup' && arguments_[1] === 'shift',
    ),
  )
  assert.ok(
    fake.commands.some(
      ({ arguments: arguments_ }) => arguments_[0] === 'keyup' && arguments_[1] === 'ctrl',
    ),
  )
})

test('rejects unknown nested action fields before execution', async () => {
  const fake = fakeDependencies()
  const result = await executeComputerUse(
    {
      tool_call_id: 'tool-12',
      actions: [
        {
          click: {
            button: 'MOUSE_BUTTON_LEFT',
            count: 1,
            modifier_key: 'CTRL',
          },
        } as never,
      ],
    },
    fake.dependencies,
  )

  assert.ok('error' in result)
  assert.match(result.error.error, /unknown field: modifier_key/)
  assert.deepEqual(fake.commands, [])
})

test('classifies an unreachable assigned display as unavailable', async () => {
  const fake = fakeDependencies()
  fake.dependencies.run = async () => {
    throw new Error('unable to open display')
  }
  const result = await executeComputerUse(
    { tool_call_id: 'tool-13', actions: [{ screenshot: {} }] },
    fake.dependencies,
  )

  assert.ok('error' in result)
  assert.equal(result.error.error_code, 'DESKTOP_UNAVAILABLE')
})
