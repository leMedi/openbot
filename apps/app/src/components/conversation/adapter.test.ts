import { describe, expect, it } from 'vitest'
import type { ConversationMessage } from '@openbot/db'
import { entriesFromMessages, entryFromMessage } from './adapter'
import type { Author } from './types'

const agent: Author = { id: 'agt_1', name: 'Helper', color: '#333', kind: 'agent' }

let seq = 0
function makeRow(overrides: Partial<ConversationMessage>): ConversationMessage {
  seq += 1
  return {
    id: `ent_${seq}`,
    conversationId: 'cnv_1',
    turnId: 'trn_1',
    sequenceNo: seq,
    kind: 'message',
    role: 'assistant',
    direction: 'outbound',
    senderAgentId: null,
    recipientAgentId: null,
    deliveryId: null,
    bodyText: null,
    payloadJson: { version: 1 },
    replyToEntryId: null,
    threadRootEntryId: null,
    branchParentEntryId: null,
    reactionsJson: { version: 1, items: [] },
    attachmentsJson: { version: 1, items: [] },
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    ...overrides,
  } as ConversationMessage
}

describe('entryFromMessage', () => {
  it('renders a delivered text row as an agent markdown bubble', () => {
    const entry = entryFromMessage(
      makeRow({
        bodyText: 'Here is the **answer**.',
        payloadJson: {
          version: 1,
          deliveryKind: 'send-message',
          type: 'text',
          toolCallId: 'call_1',
        },
      }),
      agent,
    )
    expect(entry).toMatchObject({
      type: 'message',
      author: agent,
      markdown: 'Here is the **answer**.',
    })
  })

  it('renders a widget row as a passive text card with its options', () => {
    const entry = entryFromMessage(
      makeRow({
        bodyText: 'Which one?',
        payloadJson: {
          version: 1,
          deliveryKind: 'send-message',
          type: 'widget',
          toolCallId: 'call_2',
          widget: {
            prompt: 'Which one?',
            options: [
              { id: 'a', label: 'Alpha' },
              { id: 'b', label: 'Beta' },
            ],
          },
        },
      }),
      agent,
    )
    expect(entry).toMatchObject({
      type: 'message',
      cards: [{ kind: 'text', title: 'Which one?', body: '- Alpha\n- Beta' }],
    })
    expect((entry as { markdown?: string }).markdown).toBeUndefined()
  })

  it('renders an attachment row as a downloadable file tile', () => {
    const entry = entryFromMessage(
      makeRow({
        bodyText: 'The report',
        payloadJson: {
          version: 1,
          deliveryKind: 'send-message',
          type: 'attachment',
          toolCallId: 'call_3',
          alt: 'The report',
        },
        attachmentsJson: {
          version: 1,
          items: [
            {
              fileId: 'fil_9',
              position: 0,
              metadata: { name: 'report.txt', mediaType: 'text/plain', byteSize: 2048 },
            },
          ],
        },
      }),
      agent,
    )
    expect(entry).toMatchObject({
      type: 'message',
      attachments: [
        {
          id: 'fil_9',
          name: 'report.txt',
          size: '2 KB',
          kind: 'file',
          url: '/api/files/fil_9',
        },
      ],
    })
  })

  it('hides the internal turn_waiting status row', () => {
    const row = makeRow({
      kind: 'status',
      role: null,
      direction: 'internal',
      bodyText: 'Which one?',
      payloadJson: { version: 1, event: 'turn_waiting', prompt: 'Which one?' },
    })
    expect(entryFromMessage(row, agent)).toBeNull()
    expect(entriesFromMessages([row], agent)).toHaveLength(0)
  })

  it('keeps legacy assistant rows rendering unchanged', () => {
    const entry = entryFromMessage(
      makeRow({ bodyText: 'old style answer' }),
      agent,
    )
    expect(entry).toMatchObject({ type: 'message', markdown: 'old style answer' })
  })
})
