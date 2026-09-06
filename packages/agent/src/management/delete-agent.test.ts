import assert from 'node:assert/strict'
import { access, chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'

const testData = path.resolve(process.cwd(), '../../.data', `agent-deletion-management-${process.pid}`)
await rm(testData, { recursive: true, force: true })
await mkdir(testData, { recursive: true })
process.env.OPENBOT_DATA_DIR = testData

const binaryPath = path.join(testData, 'stop-window')
const invocationLog = path.join(testData, 'stop-window.log')
await writeFile(
  binaryPath,
  `#!/usr/bin/env node
const fs = require('node:fs')
fs.appendFileSync(process.env.OPENBOT_TEST_STOP_WINDOW_LOG, JSON.stringify(process.argv.slice(2)) + '\\n')
const exitCode = Number(process.env.OPENBOT_TEST_STOP_WINDOW_EXIT || 0)
if (exitCode !== 0) process.stderr.write('desktop teardown failed')
process.exit(exitCode)
`,
)
await chmod(binaryPath, 0o755)
await writeFile(invocationLog, '')
process.env.OPENBOT_STOP_WINDOW = binaryPath
process.env.OPENBOT_TEST_STOP_WINDOW_LOG = invocationLog

const [{ deleteAgent, StopWindowError }, db] = await Promise.all([
  import('./delete-agent'),
  import('@openbot/db'),
])

function createAgentWithDisplay(name: string, displayNumber?: number) {
  return db.db.transaction((transaction) =>
    db.createAgentInTransaction(transaction, { name }, [], { xDisplayNumber: displayNumber }),
  )
}

async function exists(target: string) {
  try {
    await access(target)
    return true
  } catch {
    return false
  }
}

test('stops the assigned display and removes only per-agent filesystem state', async () => {
  const created = await createAgentWithDisplay('Managed deletion', 56_311)
  const workspace = path.join(testData, 'workspaces', created.agent.id)
  const profile = path.join(testData, 'chrome-profiles', created.agent.id)
  const sharedCookies = path.join(testData, 'browser', 'shared-cookies.json')
  const browserState = '/tmp/.browser'
  const artifacts = [
    path.join(browserState, 'views-56311.json'),
    path.join(browserState, 'views-56311.json.lock'),
    path.join(browserState, 'views-56311.json.123.456.tmp'),
  ]
  await Promise.all([
    mkdir(workspace, { recursive: true }),
    mkdir(profile, { recursive: true }),
    mkdir(path.dirname(sharedCookies), { recursive: true }),
    mkdir(browserState, { recursive: true }),
  ])
  await Promise.all([
    writeFile(path.join(workspace, 'work.txt'), 'work'),
    writeFile(path.join(profile, 'Preferences'), '{}'),
    writeFile(sharedCookies, '{}'),
    ...artifacts.map((artifact) => writeFile(artifact, '{}')),
  ])

  assert.equal(await deleteAgent(created.agent.id), true)
  const invocations = (await readFile(invocationLog, 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
  assert.deepEqual(invocations.at(-1), ['56311', created.agent.id])
  assert.equal(await exists(workspace), false)
  assert.equal(await exists(profile), false)
  assert.equal(await exists(sharedCookies), true)
  for (const artifact of artifacts) assert.equal(await exists(artifact), false)
})

test('refuses database deletion when desktop teardown fails', async () => {
  const created = await createAgentWithDisplay('Failed teardown', 56_312)
  const pending = await db.acceptUserMessage({
    conversationId: created.conversation.id,
    text: 'Preserve this pending work',
  })
  const workspace = path.join(testData, 'workspaces', created.agent.id)
  await mkdir(workspace, { recursive: true })
  process.env.OPENBOT_TEST_STOP_WINDOW_EXIT = '9'
  try {
    await assert.rejects(deleteAgent(created.agent.id), (error) => {
      assert.ok(error instanceof StopWindowError)
      assert.equal(error.exitCode, 9)
      assert.match(error.message, /desktop teardown failed/)
      assert.match(error.message, new RegExp(created.agent.id))
      assert.match(error.message, /display :56312/)
      return true
    })
  } finally {
    delete process.env.OPENBOT_TEST_STOP_WINDOW_EXIT
  }
  assert.ok(await db.getAgent(created.agent.id))
  assert.notEqual((await db.getTurn(pending.turn.id))?.status, 'cancelled')
  assert.equal(await exists(workspace), true)
  assert.equal(await deleteAgent(created.agent.id), true)
})

test('tears down assigned displays even in disabled mode and skips agents without one', async () => {
  const invocationCount = (await readFile(invocationLog, 'utf8')).trim().split('\n').filter(Boolean).length
  const disabled = await createAgentWithDisplay('Disabled desktop deletion', 56_313)
  process.env.OPENBOT_DESKTOP_MODE = 'disabled'
  try {
    assert.equal(await deleteAgent(disabled.agent.id), true)
  } finally {
    delete process.env.OPENBOT_DESKTOP_MODE
  }

  const withoutDisplay = await createAgentWithDisplay('No display deletion')
  assert.equal(await deleteAgent(withoutDisplay.agent.id), true)
  const finalInvocationCount = (await readFile(invocationLog, 'utf8'))
    .trim()
    .split('\n')
    .filter(Boolean).length
  assert.equal(finalInvocationCount, invocationCount + 1)
  assert.equal(await deleteAgent(withoutDisplay.agent.id), false)
})
