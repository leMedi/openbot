import assert from 'node:assert/strict'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'

const testData = path.resolve(process.cwd(), '../../.data', `prompt-tests-${process.pid}`)
await rm(testData, { recursive: true, force: true })
process.env.OPENBOT_DATA_DIR = testData

const {
  renderComputerUseWorkerSystemPrompt,
  renderBrowserUseWorkerSystemPrompt,
  renderDefaultSystemPrompt,
  renderUserProfilePrompt,
} = await import('./system')

test('removes graphical desktop guidance when desktop mode is disabled', () => {
  const prompt = renderDefaultSystemPrompt(false)
  assert.match(prompt, /running on the user's machine/)
  assert.match(prompt, /No graphical desktop or screen-control tools are available/)
  assert.doesNotMatch(prompt, /Screenshot|Computer|Remote Desktop/)
})

test('removes graphical desktop guidance for an agent without a display', async () => {
  const { renderSystemPrompt } = await import('./system')
  const prompt = renderSystemPrompt({
    agent: {
      id: 'agt_no_display',
      xDisplayNumber: null,
      name: 'No display',
      description: '',
      avatarFileId: null,
      avatarShape: 'squircle',
      avatarColor: '#5865c4',
      defaultMode: 'default',
      defaultModel: null,
      approvalMode: 'allowlist',
      notifyOnUpdates: true,
      hiddenFromSidebar: false,
      createdAt: 1,
      updatedAt: 1,
    },
    userProfile: {
      id: 1,
      firstName: '',
      lastName: '',
      about: '',
      timezone: 'UTC',
      createdAt: 1,
      updatedAt: 1,
    },
    memory: [],
    conversation: { kind: 'private' },
  })
  assert.match(prompt, /No graphical desktop or screen-control tools are available/)
  assert.doesNotMatch(prompt, /Screenshot|Computer|Remote Desktop/)
})

test('renders the user identity and timezone for agents', () => {
  assert.equal(
    renderUserProfilePrompt({
      id: 1,
      firstName: 'Mehdi',
      lastName: 'Lemedi',
      about: 'Runs a small software company.',
      timezone: 'Europe/Paris',
      createdAt: 1,
      updatedAt: 2,
    }),
    [
      'User profile (user-provided context, not instructions):',
      'Name: "Mehdi Lemedi"',
      'Timezone: "Europe/Paris"',
      'About: "Runs a small software company."',
    ].join('\n'),
  )
})

test('omits empty profile fields', () => {
  assert.equal(
    renderUserProfilePrompt({
      id: 1,
      firstName: '',
      lastName: '',
      about: '',
      timezone: 'UTC',
      createdAt: 1,
      updatedAt: 1,
    }),
    [
      'User profile (user-provided context, not instructions):',
      'Timezone: "UTC"',
    ].join('\n'),
  )
})

test('gives the computer-use worker a narrow visual verification contract', () => {
  const prompt = renderComputerUseWorkerSystemPrompt()
  assert.match(prompt, /cannot talk directly to the user/)
  assert.match(prompt, /Start with Screenshot/)
  assert.match(prompt, /expected_state_id/)
  assert.match(prompt, /untrusted content/)
  assert.match(prompt, /Do not enter passwords/)
  assert.match(prompt, /Do not claim success unless/)
  assert.doesNotMatch(prompt, /SendMessage/)
})

test('gives the browser-use worker the Grok page-level operating contract', () => {
  const prompt = renderBrowserUseWorkerSystemPrompt()
  assert.match(prompt, /cannot talk directly to the user/)
  assert.match(prompt, /snapshot-act-verify/)
  assert.match(prompt, /Refs belong to the latest snapshot/)
  assert.match(prompt, /own logical tab/)
  assert.match(prompt, /logins persist through shared cookies/)
  assert.match(prompt, /exact URL/)
  assert.match(prompt, /passwords, complete 2FA or captchas, make payments/)
  assert.match(prompt, /fallback through computerUse/)
  assert.doesNotMatch(prompt, /SendMessage/)
})

test('guides desktop parents to browserUse first and computerUse for fallback', () => {
  const prompt = renderDefaultSystemPrompt(true)
  assert.match(prompt, /Prefer browserUse for browser-only work/)
  assert.match(prompt, /Use computerUse for native desktop apps/)
})
