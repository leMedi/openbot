import assert from 'node:assert/strict'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'

const testData = path.resolve(process.cwd(), '../../.data', `prompt-action-${process.pid}`)
await rm(testData, { recursive: true, force: true })
process.env.OPENBOT_DATA_DIR = testData

const { renderResumeText } = await import('./action')

const waitingState = {
  version: 1 as const,
  interactionKind: 'handoff' as const,
  prompt: 'Sign in',
  options: [
    { id: 'hand_back', label: 'Hand back' },
    { id: 'skip', label: 'Skip' },
  ],
  allowCustom: false,
  dismissOnMoveOn: false,
  originatingToolCall: { id: 'call_handoff', name: 'RequestDesktopHelp' },
  resumeData: { version: 1, kind: 'desktop-handoff' },
  response: {
    optionId: 'hand_back',
    text: 'Hand back',
    dismissed: false,
    requestId: 'request',
    idempotencyKey: 'idempotency',
    respondedAt: 1,
  },
}

test('resumes a desktop handoff with inspect-then-redispatch guidance', () => {
  const text = renderResumeText({
    waitingState,
    desktopEnabled: true,
    browserApproval: false,
    computerApproval: false,
    approvedPluginHasAccount: false,
  })
  assert.match(text ?? '', /handed the Remote Desktop back/)
  assert.match(text ?? '', /read-only Screenshot/)
  assert.match(text ?? '', /new browserUse task/)
})
