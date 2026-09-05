import assert from 'node:assert/strict'
import { access, chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { ComputerUseClient, ComputerUseClientError } from './client'
import type { ExecServerMessage } from './contract'

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

const webp = fakeWebP()

const request: ExecServerMessage = {
  id: 42,
  exec_id: 'exec-42',
  computer_use_args: {
    tool_call_id: 'tool-42',
    actions: [{ screenshot: {} }],
  },
}

async function fixture(responseExpression: string) {
  const directory = await mkdtemp(join(tmpdir(), 'openbot-desktop-client-test-'))
  const path = join(directory, 'fixture.mjs')
  await writeFile(
    path,
    `let input = ''; for await (const chunk of process.stdin) input += chunk; const request = JSON.parse(input); process.stdout.write(JSON.stringify(${responseExpression}));`,
  )
  return { directory, path }
}

test('adds a private temporary screenshot path to successful responses', async () => {
  const program = await fixture(`({exec_client_message:{id:request.id,exec_id:request.exec_id,computer_use_result:{success:{action_count:1,duration_ms:3,screenshot:${JSON.stringify(webp.toString('base64'))}}}}})`)
  const client = new ComputerUseClient({
    executable: process.execPath,
    arguments: [program.path],
    displayNumber: 7,
  })
  try {
    const response = await client.exec(request)
    assert.ok('exec_client_message' in response)
    const result = response.exec_client_message.computer_use_result
    assert.ok('success' in result)
    assert.ok(result.success.screenshot_path)
    assert.deepEqual(await readFile(result.success.screenshot_path), webp)
    const path = result.success.screenshot_path
    await client.dispose()
    await assert.rejects(access(path))
  } finally {
    await client.dispose()
    await rm(program.directory, { recursive: true, force: true })
  }
})

test('rejects a response for a different request identity', async () => {
  const program = await fixture(`({exec_client_message:{id:request.id+1,exec_id:request.exec_id,computer_use_result:{success:{action_count:1,duration_ms:3}}}})`)
  const client = new ComputerUseClient({
    executable: process.execPath,
    arguments: [program.path],
    displayNumber: 1,
  })
  try {
    await assert.rejects(client.exec(request), ComputerUseClientError)
  } finally {
    await client.dispose()
    await rm(program.directory, { recursive: true, force: true })
  }
})

test('rejects screenshot text that is not WebP', async () => {
  const program = await fixture(`({exec_client_message:{id:request.id,exec_id:request.exec_id,computer_use_result:{error:{error:'failed',action_count:0,duration_ms:3,screenshot:Buffer.from('not webp').toString('base64')}}}})`)
  const client = new ComputerUseClient({
    executable: process.execPath,
    arguments: [program.path],
    displayNumber: 1,
  })
  try {
    await assert.rejects(client.exec(request), /not WebP/)
  } finally {
    await client.dispose()
    await rm(program.directory, { recursive: true, force: true })
  }
})

test('rejects an empty screenshot instead of skipping augmentation', async () => {
  const program = await fixture(`({exec_client_message:{id:request.id,exec_id:request.exec_id,computer_use_result:{success:{action_count:1,duration_ms:3,screenshot:''}}}})`)
  const client = new ComputerUseClient({
    executable: process.execPath,
    arguments: [program.path],
    displayNumber: 1,
  })
  try {
    await assert.rejects(client.exec(request), /screenshot is empty/)
  } finally {
    await client.dispose()
    await rm(program.directory, { recursive: true, force: true })
  }
})

test('rejects responses with multiple or unknown envelope fields', async () => {
  const program = await fixture(`({exec_client_message:{id:request.id,exec_id:request.exec_id,computer_use_result:{success:{action_count:1,duration_ms:3}}},exec_client_control_message:{heartbeat:{id:request.id}}})`)
  const client = new ComputerUseClient({
    executable: process.execPath,
    arguments: [program.path],
    displayNumber: 1,
  })
  try {
    await assert.rejects(client.exec(request), /exactly one envelope variant/)
  } finally {
    await client.dispose()
    await rm(program.directory, { recursive: true, force: true })
  }
})

test('invokes the JSON CLI contract end to end', async () => {
  const cliPath = fileURLToPath(new URL('./cli.ts', import.meta.url))
  const toolsDirectory = await mkdtemp(join(tmpdir(), 'openbot-desktop-tools-test-'))
  const xdotool = join(toolsDirectory, 'xdotool')
  await writeFile(
    xdotool,
    `#!${process.execPath}\nif (process.argv[2] === 'getdisplaygeometry') process.stdout.write('1280 800\\n')`,
  )
  await chmod(xdotool, 0o700)
  const client = new ComputerUseClient({
    executable: process.execPath,
    arguments: ['--import', 'tsx', cliPath],
    displayNumber: 12,
    environment: { PATH: `${toolsDirectory}:${process.env.PATH ?? ''}` },
  })
  try {
    const response = await client.exec({
      ...request,
      computer_use_args: {
        ...request.computer_use_args,
        actions: [{ wait: { duration_ms: 0 } }],
      },
    })
    assert.ok('exec_client_message' in response)
    const result = response.exec_client_message.computer_use_result
    assert.ok('success' in result)
    assert.equal(result.success.action_count, 1)
  } finally {
    await client.dispose()
    await rm(toolsDirectory, { recursive: true, force: true })
  }
})

test(
  'kills the driver process tree on timeout',
  { skip: process.platform === 'win32' },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'openbot-desktop-timeout-test-'))
    const workerPath = join(directory, 'worker.mjs')
    const driverPath = join(directory, 'driver.mjs')
    const pidPath = join(directory, 'worker.pid')
    await writeFile(workerPath, `process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)`)
    await writeFile(
      driverPath,
      `import { spawn } from 'node:child_process'; import { writeFileSync } from 'node:fs'; for await (const _ of process.stdin) {} const worker = spawn(process.execPath, [${JSON.stringify(workerPath)}], {stdio:'ignore'}); writeFileSync(${JSON.stringify(pidPath)}, String(worker.pid)); setInterval(() => {}, 1000);`,
    )
    const client = new ComputerUseClient({
      executable: process.execPath,
      arguments: [driverPath],
      displayNumber: 1,
      timeoutMs: 200,
    })
    let workerPid: number | undefined
    try {
      await assert.rejects(client.exec(request), /timed out/)
      workerPid = Number(await readFile(pidPath, 'utf8'))
      let alive = true
      for (let attempt = 0; attempt < 40 && alive; attempt += 1) {
        try {
          process.kill(workerPid, 0)
          await new Promise((resolve) => setTimeout(resolve, 25))
        } catch {
          alive = false
        }
      }
      assert.equal(alive, false, 'worker process survived the client timeout')
    } finally {
      if (workerPid) {
        try {
          process.kill(workerPid, 'SIGKILL')
        } catch {
          // Already terminated as expected.
        }
      }
      await client.dispose()
      await rm(directory, { recursive: true, force: true })
    }
  },
)

test('shares one owned temporary directory across concurrent requests', async () => {
  const program = await fixture(`({exec_client_message:{id:request.id,exec_id:request.exec_id,computer_use_result:{success:{action_count:1,duration_ms:3,screenshot:${JSON.stringify(webp.toString('base64'))}}}}})`)
  const client = new ComputerUseClient({
    executable: process.execPath,
    arguments: [program.path],
    displayNumber: 7,
  })
  try {
    const [first, second] = await Promise.all([
      client.exec(request),
      client.exec({ ...request, id: 43, exec_id: 'exec-43' }),
    ])
    assert.ok('exec_client_message' in first && 'exec_client_message' in second)
    const firstResult = first.exec_client_message.computer_use_result
    const secondResult = second.exec_client_message.computer_use_result
    assert.ok('success' in firstResult && 'success' in secondResult)
    const firstPath = firstResult.success.screenshot_path!
    const secondPath = secondResult.success.screenshot_path!
    assert.equal(firstPath.slice(0, firstPath.lastIndexOf('/')), secondPath.slice(0, secondPath.lastIndexOf('/')))
    await client.dispose()
    await assert.rejects(access(firstPath))
    await assert.rejects(access(secondPath))
  } finally {
    await client.dispose()
    await rm(program.directory, { recursive: true, force: true })
  }
})
