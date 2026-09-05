import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { DesktopDriverError, ProcessDesktopDriver, type DesktopAction } from './driver'

function fakeWebP() {
  const payload = Buffer.alloc(10)
  payload.writeUIntLE(1279, 4, 3)
  payload.writeUIntLE(799, 7, 3)
  const size = Buffer.alloc(4)
  size.writeUInt32LE(payload.length)
  const riffSize = Buffer.alloc(4)
  riffSize.writeUInt32LE(4 + 8 + payload.length)
  return Buffer.concat([Buffer.from('RIFF'), riffSize, Buffer.from('WEBPVP8X'), size, payload])
}

async function fixture(responseBody: string) {
  const directory = await mkdtemp(join(tmpdir(), 'openbot-process-driver-test-'))
  const executable = join(directory, 'driver.mjs')
  const requestPath = join(directory, 'request.json')
  await writeFile(
    executable,
    `import { writeFileSync } from 'node:fs'; let input=''; for await (const chunk of process.stdin) input += chunk; const request=JSON.parse(input); writeFileSync(process.argv[2], input); process.stdout.write(JSON.stringify({exec_client_message:{id:request.id,exec_id:request.exec_id,computer_use_result:${responseBody}}}));`,
  )
  return { directory, executable, requestPath }
}

test('does not send the runtime compatibility screenshot as an eleventh action', async () => {
  const program = await fixture(`{success:{action_count:10,duration_ms:1}}`)
  const driver = new ProcessDesktopDriver(process.execPath, 7, [
    program.executable,
    program.requestPath,
  ])
  try {
    const actions: DesktopAction[] = [
      ...Array.from({ length: 10 }, () => ({ action: 'wait' as const, durationMs: 0 })),
      { action: 'screenshot' },
    ]
    await driver.execute(actions)
    const request = JSON.parse(await readFile(program.requestPath, 'utf8')) as {
      computer_use_args: { actions: unknown[] }
    }
    assert.equal(request.computer_use_args.actions.length, 10)
  } finally {
    await rm(program.directory, { recursive: true, force: true })
  }
})

test('preserves failure screenshots on DesktopDriverError', async () => {
  const webp = fakeWebP()
  const program = await fixture(
    `{error:{error:'action failed',action_count:1,duration_ms:1,screenshot:${JSON.stringify(webp.toString('base64'))}}}`,
  )
  const driver = new ProcessDesktopDriver(process.execPath, 8, [
    program.executable,
    program.requestPath,
  ])
  try {
    await assert.rejects(driver.execute([{ action: 'wait', durationMs: 0 }]), (error) => {
      assert.ok(error instanceof DesktopDriverError)
      assert.equal(error.execution?.screenshot?.dataBase64, webp.toString('base64'))
      return true
    })
  } finally {
    await rm(program.directory, { recursive: true, force: true })
  }
})

test('classifies a missing process executable as desktop unavailable', async () => {
  const driver = new ProcessDesktopDriver('/definitely/missing/openbot-driver', 9)
  await assert.rejects(driver.getDisplay(), (error) => {
    assert.ok(error instanceof DesktopDriverError)
    assert.equal(error.code, 'desktop_unavailable')
    return true
  })
})

test('requests cursor position with a screenshot', async () => {
  const webp = fakeWebP()
  const program = await fixture(
    `{success:{action_count:2,duration_ms:1,screenshot:${JSON.stringify(webp.toString('base64'))},cursor_position:{x:3,y:4}}}`,
  )
  const driver = new ProcessDesktopDriver(process.execPath, 10, [
    program.executable,
    program.requestPath,
  ])
  try {
    const screenshot = await driver.captureScreenshot()
    assert.deepEqual(screenshot.cursor, { x: 3, y: 4 })
    const request = JSON.parse(await readFile(program.requestPath, 'utf8')) as {
      computer_use_args: { actions: unknown[] }
    }
    assert.deepEqual(request.computer_use_args.actions, [{ screenshot: {} }])
  } finally {
    await rm(program.directory, { recursive: true, force: true })
  }
})

test('bounds the aggregate protocol description', async () => {
  const program = await fixture(`{success:{action_count:2,duration_ms:1}}`)
  const driver = new ProcessDesktopDriver(process.execPath, 11, [
    program.executable,
    program.requestPath,
  ])
  try {
    await driver.execute([
      { action: 'move', x: 1, y: 1, description: 'a'.repeat(400) },
      { action: 'move', x: 2, y: 2, description: 'b'.repeat(400) },
    ])
    const request = JSON.parse(await readFile(program.requestPath, 'utf8')) as {
      computer_use_args: { description: string }
    }
    assert.equal(request.computer_use_args.description.length, 500)
  } finally {
    await rm(program.directory, { recursive: true, force: true })
  }
})
