import assert from 'node:assert/strict'
import test from 'node:test'
import type { ConversationMessage } from '@openbot/db'
import { entryFromMessage } from './adapter'
import type { Author } from './types'

const agent: Author = {
  id: 'agent-1',
  name: 'Agent',
  color: '#000000',
  kind: 'agent',
}

function row(
  input: Partial<ConversationMessage> &
    Pick<ConversationMessage, 'kind' | 'payloadJson'>,
): ConversationMessage {
  return {
    id: crypto.randomUUID(),
    conversationId: 'conversation-1',
    turnId: 'turn-1',
    sequenceNo: 1,
    role: null,
    direction: 'outbound',
    senderAgentId: 'agent-1',
    recipientAgentId: null,
    deliveryId: null,
    bodyText: null,
    replyToEntryId: null,
    threadRootEntryId: null,
    branchParentEntryId: null,
    reactionsJson: { version: 1, items: [] },
    attachmentsJson: { version: 1, items: [] },
    createdAt: 1,
    updatedAt: 1,
    ...input,
  }
}

test('adapts screenshots and normalized failures at the presentation boundary', () => {
  const screenshot = entryFromMessage(
    row({
      kind: 'tool_result',
      role: 'tool',
      bodyText: 'Captured the Remote Desktop',
      payloadJson: {
        version: 1,
        event: 'computer-use',
        toolCallId: 'screenshot-call',
        name: 'Screenshot',
        preview: 'Captured the Remote Desktop',
        status: 'success',
        outcome: 'success',
        detail: 'Captured the Remote Desktop',
        screenshot: {
          fileId: 'file-1',
          url: '/api/files/file-1',
          mediaType: 'image/png',
          width: 1280,
          height: 800,
          stateId: 'state-1',
          cursor: { x: 20, y: 30 },
        },
      },
    }),
    agent,
  )
  assert.equal(screenshot?.type, 'tool')
  if (screenshot?.type !== 'tool') return
  assert.equal(screenshot.call.status, 'success')
  assert.equal(screenshot.result?.imageUrl, '/api/files/file-1')
  assert.deepEqual(screenshot.result?.dimensions, { width: 1280, height: 800 })
  assert.deepEqual(screenshot.result?.cursor, { x: 20, y: 30 })

  const busy = entryFromMessage(
    row({
      kind: 'tool_result',
      role: 'tool',
      bodyText: 'Another agent is controlling the Remote Desktop',
      payloadJson: {
        version: 1,
        event: 'computer-use',
        toolCallId: 'busy-call',
        name: 'Computer',
        preview: 'Another agent is controlling the Remote Desktop',
        status: 'failed',
        outcome: 'desktop_busy',
        detail: 'Another agent is controlling the Remote Desktop',
      },
    }),
    agent,
  )
  assert.equal(busy?.type, 'tool')
  if (busy?.type !== 'tool') return
  assert.equal(busy.call.status, 'failed')
  assert.equal(busy.result?.status, 'desktop busy')
})

test('adapts Computer progress and approval prompts without client execution', () => {
  const progress = entryFromMessage(
    row({
      kind: 'status',
      bodyText: 'Computer: click the Save button',
      payloadJson: {
        version: 1,
        event: 'computer-use-progress',
        toolCallId: 'computer-call',
        name: 'Computer',
        preview: 'click the Save button',
        status: 'pending',
        fingerprint: 'fingerprint-1',
      },
    }),
    agent,
  )
  assert.equal(progress?.type, 'timeline')
  if (progress?.type !== 'timeline') return
  assert.equal(progress.text, 'Computer: click the Save button')

  const approval = entryFromMessage(
    row({
      kind: 'message',
      role: 'assistant',
      bodyText: 'Allow Computer to click Save?',
      payloadJson: {
        version: 1,
        deliveryKind: 'send-message',
        type: 'widget',
        toolCallId: 'computer-call',
        widget: {
          prompt: 'Allow Computer to click Save?',
          interactionKind: 'approval',
          options: [
            { id: 'approve', label: 'Allow once' },
            { id: 'deny', label: 'Deny' },
          ],
          allowCustom: false,
          dismissOnMoveOn: false,
        },
      },
    }),
    agent,
  )
  assert.equal(approval?.type, 'message')
  if (approval?.type !== 'message') return
  assert.equal(approval.widget?.kind, 'approval')
  assert.equal(approval.widget?.status, 'pending')
})
