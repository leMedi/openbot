import assert from 'node:assert/strict'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'

const testData = path.resolve(process.cwd(), '../../.data', `prompt-assembly-tests-${process.pid}`)
await rm(testData, { recursive: true, force: true })
process.env.OPENBOT_DATA_DIR = testData

const store = await import('@openbot/db')
const { renderPrivateTurnPrompt } = await import('./assembly')

test('orders and deduplicates prepended context before the current message', async () => {
  const { conversation } = await store.createAgent({ name: 'Collector' })
  const earlier = await store.acceptUserMessage({
    conversationId: conversation.id,
    text: 'Earlier while busy',
  })
  const file = await store.createManagedFile({
    bytes: new Uint8Array([1]),
    originalName: 'chart.png',
    mediaType: 'image/png',
    subdirectory: 'tests',
    extension: 'png',
  })
  const current = await store.acceptUserMessage({
    conversationId: conversation.id,
    text: 'Current request',
    replyToEntryId: earlier.message.id,
    attachments: {
      version: 1,
      items: [{
        fileId: file.id,
        position: 0,
        metadata: { name: 'chart.png', mediaType: 'image/png' },
      }],
    },
  })

  const prompt = await renderPrivateTurnPrompt({
    conversationId: conversation.id,
    turnId: current.turn.id,
    prependedMessages: [
      { id: 'evt_1', type: 'unanswered-question', text: 'Choose a format?' },
      { id: 'evt_1', type: 'unanswered-question', text: 'Choose a format?' },
    ],
  })
  assert.equal(prompt.match(/Choose a format\?/g)?.length, 1)
  assert.ok(prompt.indexOf('Earlier while busy') < prompt.indexOf('Current request'))
  assert.match(prompt, new RegExp(`\\[reply_to: ${earlier.message.id}\\]`))
  assert.match(prompt, new RegExp(`\\[message_id: ${current.message.id}\\]`))
  assert.match(prompt, new RegExp(`chart\\.png \\(image/png, file id: ${file.id}\\)`))
})
