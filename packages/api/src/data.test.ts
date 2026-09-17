import assert from 'node:assert/strict'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'

const testData = path.resolve(process.cwd(), '../../.data', `api-data-tests-${process.pid}`)
await rm(testData, { recursive: true, force: true })
process.env.OPENBOT_DATA_DIR = testData

const { appDataTargets, toCleanTargets } = await import('./procedures/data')

test('offers plugin cleanup and maps it to persisted MCP data', () => {
  assert.ok(appDataTargets.includes('plugins'))
  assert.deepEqual(toCleanTargets(['bots', 'plugins']), new Set(['bots', 'mcps']))
})
