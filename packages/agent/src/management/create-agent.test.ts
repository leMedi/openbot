import assert from 'node:assert/strict'
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'

const testData = path.resolve(process.cwd(), '../../.data', `agent-creation-tests-${process.pid}`)
await rm(testData, { recursive: true, force: true })
await mkdir(testData, { recursive: true })
process.env.OPENBOT_DATA_DIR = testData

const binaryPath = path.join(testData, 'start-window')
const invocationLog = path.join(testData, 'start-window.log')
await writeFile(
  binaryPath,
  `#!/usr/bin/env node
const fs = require('node:fs')
fs.appendFileSync(process.env.OPENBOT_TEST_START_WINDOW_LOG, JSON.stringify(process.argv.slice(2)) + '\\n')
const exitCode = Number(process.env.OPENBOT_TEST_START_WINDOW_EXIT || 0)
if (exitCode !== 0) process.stderr.write('display provisioning failed')
process.exit(exitCode)
`,
)
await chmod(binaryPath, 0o755)
process.env.OPENBOT_START_WINDOW = binaryPath
process.env.OPENBOT_TEST_START_WINDOW_LOG = invocationLog

const [{ createAgent, StartWindowError }, { listAgents, listConversations }] =
  await Promise.all([
    import('./create-agent'),
    import('@openbot/db'),
  ])

test('creates the database records and provisions sequential agent displays', async () => {
  const first = await createAgent({ name: 'First managed agent' })
  const second = await createAgent({ name: 'Second managed agent' })

  assert.equal(first.agent.xDisplayNumber, 1)
  assert.equal(second.agent.xDisplayNumber, 2)
  const invocations = (await readFile(invocationLog, 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
  assert.deepEqual(invocations, [
    ['1', first.agent.id],
    ['2', second.agent.id],
  ])
})

test('rolls back agent records when display provisioning fails', async () => {
  const agentCountBefore = (await listAgents()).length
  const conversationCountBefore = (await listConversations()).length
  process.env.OPENBOT_TEST_START_WINDOW_EXIT = '75'

  await assert.rejects(createAgent({ name: 'Agent without a display' }), (error) => {
    assert.ok(error instanceof StartWindowError)
    assert.equal(error.exitCode, 75)
    assert.match(error.message, /display provisioning failed/)
    return true
  })

  assert.equal((await listAgents()).length, agentCountBefore)
  assert.equal((await listConversations()).length, conversationCountBefore)
  delete process.env.OPENBOT_TEST_START_WINDOW_EXIT
})
