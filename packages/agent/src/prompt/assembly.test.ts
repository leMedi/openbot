import assert from 'node:assert/strict'
import { readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'

const testData = path.resolve(process.cwd(), '../../.data', `prompt-assembly-tests-${process.pid}`)
await rm(testData, { recursive: true, force: true })
process.env.OPENBOT_DATA_DIR = testData

const store = await import('@openbot/db')
const { renderPrivateTurnPrompt } = await import('./assembly')
const {
  assembleConversationTurnAction,
  assembleWorkerTurnAction,
  renderHiddenWakePrompt,
  renderResumeText,
} = await import('./action')
const { resolveTurnPolicy } = await import('./policy')
const { projectPiTurnInput } = await import('./projection')
const { stageManagedPromptAttachments, stagedAttachmentNote } = await import('./attachments')
const { collectConversationTurnContext } = await import('../queue/turn-context')

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
    workspace: path.join(testData, 'workspace'),
    prependedMessages: [
      { id: 'evt_1', type: 'unanswered-question', text: 'Choose a format?' },
      { id: 'evt_1', type: 'unanswered-question', text: 'Choose a format?' },
    ],
  })
  assert.equal(prompt.match(/Choose a format\?/g)?.length, 1)
  assert.ok(prompt.indexOf('Earlier while busy') < prompt.indexOf('Current request'))
  assert.match(prompt, new RegExp(`\\[reply_to: ${earlier.message.id}\\]`))
  assert.match(prompt, new RegExp(`\\[message_id: ${current.message.id}\\]`))
  const stagedPath = path.join(testData, 'workspace', 'uploads', file.id, 'chart.png')
  assert.match(prompt, new RegExp(`chart\\.png \\(image/png, path: ${stagedPath}\\)`))
  assert.deepEqual(await readFile(stagedPath), Buffer.from([1]))
})

test('does not duplicate direct-agent transcript rows into private actions', async () => {
  const sender = await store.createAgent({ name: 'Sender' })
  const recipient = await store.createAgent({ name: 'Recipient' })
  const direct = await store.acceptDirectAgentMessage({
    senderAgentId: sender.agent.id,
    recipientAgentId: recipient.agent.id,
    content: 'Private agent update',
  })
  const workspace = path.join(testData, 'recipient-workspace')
  assert.equal(await renderPrivateTurnPrompt({
    conversationId: recipient.conversation.id,
    turnId: direct.turn.id,
    workspace,
  }), '')

  const user = await store.acceptUserMessage({
    conversationId: recipient.conversation.id,
    text: 'What changed?',
  })
  const prompt = await renderPrivateTurnPrompt({
    conversationId: recipient.conversation.id,
    turnId: user.turn.id,
    workspace,
  })
  assert.doesNotMatch(prompt, /Private agent update/)
  assert.match(prompt, /What changed\?/)
})

test('assembles hidden actions for every background wake kind', () => {
  const completion = {
    version: 1 as const,
    childTurnId: 'child',
    parentTurnId: 'parent',
    title: 'Delegated work',
    status: 'succeeded' as const,
    summary: 'Worker result',
  }
  const cases = [
    ['routine', {
      version: 1 as const,
      wake: {
        version: 1 as const,
        type: 'routine' as const,
        routineId: 'routine',
        routineRevision: 1,
        name: 'Daily check',
        instruction: 'Check it.',
        cronExpression: '0 9 * * *',
        timezone: 'UTC',
        enabled: true,
        nextRunAt: null,
        scheduledFor: 1,
      },
    }, '[scheduled_routine]'],
    ['user-reaction', {
      version: 1 as const,
      wake: { version: 1, type: 'user-reaction', reaction: '👍', messageBody: 'Nice' },
    }, '[user_reaction]'],
    ['shell-completion', {
      version: 1 as const,
      wake: { version: 1, type: 'shell-completed', outputPath: 'output.txt' },
    }, 'detached shell'],
    ['browser-use-completion', {
      version: 1 as const,
      wake: { ...completion, type: 'browser-use-completed' },
    }, '[browser_task_completed]'],
    ['computer-use-completion', {
      version: 1 as const,
      wake: { ...completion, type: 'computer-use-completed' },
    }, '[computer_task_completed]'],
    ['general-subagent-completion', {
      version: 1 as const,
      wake: { ...completion, type: 'general-subagent-completed' },
    }, '[subagent_task_completed]'],
  ] as const
  for (const [source, runtimeContext, expected] of cases) {
    const escaped = expected.replaceAll('[', '\\[').replaceAll(']', '\\]')
    assert.match(renderHiddenWakePrompt(source, runtimeContext) ?? '', new RegExp(escaped))
  }
})

test('projects approval resumes as the current action', () => {
  const waitingState = store.waitingStateSchema.parse({
    version: 1,
    interactionKind: 'approval',
    prompt: 'Allow this?',
    options: [{ id: 'approve', label: 'Approve' }],
    originatingToolCall: { id: 'call', name: 'Computer' },
    resumeData: null,
    response: {
      optionId: 'approve',
      text: 'Approve',
      dismissed: false,
      requestId: 'request',
      idempotencyKey: 'idempotency',
      respondedAt: 1,
    },
  })
  assert.equal(renderResumeText({
    waitingState,
    desktopEnabled: true,
    browserApproval: false,
    computerApproval: true,
    approvedPluginHasAccount: false,
  }), '[The user approved the exact pending Computer action. Call Computer again with unchanged arguments. The approval applies only while the Remote Desktop state is unchanged.]')
})

test('projects live private context, tools, attachments, and canonical main history', async () => {
  const primary = await store.createAgent({ name: 'Projector', description: 'Projects turns' })
  const peer = await store.createAgent({ name: 'Peer agent' })
  await store.createGroup({
    name: 'Projection group',
    members: [
      { type: 'agent', agentId: primary.agent.id },
      { type: 'agent', agentId: peer.agent.id },
    ],
  })
  await store.updateProfile({
    firstName: 'Pat',
    lastName: 'Example',
    about: 'Projection tester',
    timezone: 'UTC',
  })
  await store.createMemoryItem({
    scope: 'agent',
    subjectAgentId: primary.agent.id,
    kind: 'note',
    content: 'Remember projection context',
  })
  await store.createRoutine({
    agentId: primary.agent.id,
    conversationId: primary.conversation.id,
    name: 'Projection routine',
    instruction: 'Project every morning.',
    cronExpression: '0 9 * * *',
    timezone: 'UTC',
  })
  const file = await store.createManagedFile({
    bytes: new TextEncoder().encode('attachment body'),
    originalName: '../unsafe report.txt',
    mediaType: 'text/plain',
    subdirectory: 'tests',
    extension: 'txt',
  })
  const accepted = await store.acceptUserMessage({
    conversationId: primary.conversation.id,
    text: 'Use the report.',
    attachments: {
      version: 1,
      items: [{
        fileId: file.id,
        position: 0,
        metadata: { name: '../unsafe report.txt', mediaType: 'text/plain' },
      }],
    },
  })
  const context = await collectConversationTurnContext({
    agent: primary.agent,
    conversation: primary.conversation,
  })
  const projected = await projectPiTurnInput({
    action: assembleConversationTurnAction({
      source: accepted.turn.source,
      runtimeContext: accepted.turn.runtimeContextJson,
    }),
    context,
    policy: resolveTurnPolicy({ source: accepted.turn.source }),
    turnId: accepted.turn.id,
    mcpToolCount: 2,
    toolCapabilities: {
      taskEnabled: true,
      shellEnabled: true,
      pluginManagementEnabled: true,
      routineManagementEnabled: true,
    },
  })
  const attachmentPath = path.join(
    context.workspace,
    'uploads',
    file.id,
    'unsafe report.txt',
  )
  assert.match(projected.promptText, /Use the report\./)
  assert.match(projected.promptText, new RegExp(attachmentPath))
  assert.equal((await readFile(attachmentPath, 'utf8')), 'attachment body')
  assert.match(projected.systemPrompt, /Pat Example/)
  assert.match(projected.systemPrompt, /Remember projection context/)
  assert.match(projected.systemPrompt, /Projection routine/)
  assert.match(projected.systemPrompt, /Peer agent/)
  assert.match(projected.systemPrompt, /Projection group/)
  assert.match(projected.systemPrompt, /2 connected MCP tools are available/)
  assert.equal(
    projected.sessionManager.getSessionDir(),
    await store.piSessionDirectory(primary.conversation.id),
  )
})

test('projects A2A once with staged files and the recipient main session', async () => {
  const sender = await store.createAgent({ name: 'A2A sender' })
  const recipient = await store.createAgent({ name: 'A2A recipient' })
  const file = await store.createManagedFile({
    bytes: new TextEncoder().encode('agent attachment'),
    originalName: 'handoff.txt',
    mediaType: 'text/plain',
    subdirectory: 'tests',
    extension: 'txt',
  })
  const direct = await store.acceptDirectAgentMessage({
    senderAgentId: sender.agent.id,
    recipientAgentId: recipient.agent.id,
    content: 'Review this handoff',
    attachments: {
      version: 1,
      items: [{
        fileId: file.id,
        position: 0,
        metadata: { name: 'handoff.txt', mediaType: 'text/plain' },
      }],
    },
  })
  const context = await collectConversationTurnContext({
    agent: recipient.agent,
    conversation: recipient.conversation,
  })
  const projected = await projectPiTurnInput({
    action: assembleConversationTurnAction({
      source: direct.turn.source,
      runtimeContext: direct.turn.runtimeContextJson,
    }),
    context,
    policy: resolveTurnPolicy({ source: direct.turn.source }),
    turnId: direct.turn.id,
    mcpToolCount: 0,
    toolCapabilities: {},
  })
  assert.equal(projected.promptText.match(/Review this handoff/g)?.length, 1)
  assert.match(projected.promptText, new RegExp(path.join(
    context.workspace,
    'uploads',
    file.id,
    'handoff.txt',
  )))
  assert.equal(
    projected.sessionManager.getSessionDir(),
    await store.piSessionDirectory(recipient.conversation.id),
  )
})

test('stages priority A2A attachments from durable file ids', async () => {
  const file = await store.createManagedFile({
    bytes: new Uint8Array([4, 2]),
    originalName: '../priority.png',
    mediaType: 'image/png',
    subdirectory: 'tests',
    extension: 'png',
  })
  const workspace = path.join(testData, 'priority-recipient')
  const staged = await stageManagedPromptAttachments([file.id], workspace)
  const expectedPath = path.join(workspace, 'uploads', file.id, 'priority.png')
  assert.equal(staged[0]?.path, expectedPath)
  assert.match(stagedAttachmentNote(staged), new RegExp(expectedPath))
  assert.deepEqual(await readFile(expectedPath), Buffer.from([4, 2]))
})

test('projects group room deltas through each member main session', async () => {
  const first = await store.createAgent({ name: 'First member' })
  const second = await store.createAgent({ name: 'Second member' })
  const created = await store.createGroup({
    name: 'Projection room',
    members: [
      { type: 'agent', agentId: first.agent.id },
      { type: 'agent', agentId: second.agent.id },
    ],
  })
  const accepted = await store.acceptUserMessage({
    conversationId: created.conversation.id,
    text: 'Discuss the launch.',
  })
  await store.appendConversationMessage({
    conversationId: created.conversation.id,
    kind: 'message',
    role: 'user',
    direction: 'inbound',
    bodyText: 'Approve',
    payload: { version: 1, event: 'turn_response' },
    turnId: accepted.turn.id,
  })
  const context = await collectConversationTurnContext({
    agent: first.agent,
    conversation: created.conversation,
  })
  const projected = await projectPiTurnInput({
    action: assembleConversationTurnAction({
      source: 'group-orchestrator',
      runtimeContext: { version: 1 },
      resumedText: '[The user approved the pending group action.]',
    }),
    context,
    policy: resolveTurnPolicy({ source: 'group-orchestrator' }),
    turnId: accepted.turn.id,
    mcpToolCount: 1,
    toolCapabilities: { taskEnabled: true },
  })
  assert.match(projected.promptText, /Group chat: "Projection room"/)
  assert.match(projected.promptText, /Discuss the launch\./)
  assert.match(projected.promptText, /It’s your turn, First member/)
  assert.match(projected.promptText, /approved the pending group action/)
  assert.doesNotMatch(projected.promptText, /: Approve/)
  assert.match(projected.systemPrompt, /shared group room "Projection room"/)
  assert.doesNotMatch(projected.systemPrompt, /User profile/)
  assert.equal(
    projected.sessionManager.getSessionDir(),
    await store.piSessionDirectory(first.conversation.id),
  )
})

test('projects every worker kind to isolated history', async () => {
  const created = await store.createAgent({ name: 'Worker parent' })
  const context = await collectConversationTurnContext({
    agent: created.agent,
    conversation: created.conversation,
  })
  const cases = [
    ['general-subagent', store.generalSubagentSessionDirectory],
    ['browser-use', store.browserUseWorkerSessionDirectory],
    ['computer-use', store.computerUseWorkerSessionDirectory],
  ] as const
  for (const [kind, directory] of cases) {
    const turnId = `turn-${kind}`
    const projected = await projectPiTurnInput({
      action: assembleWorkerTurnAction(kind, `${kind} task`),
      context,
      policy: resolveTurnPolicy({ source: 'subagent' }),
      turnId,
      mcpToolCount: 0,
      toolCapabilities: {},
    })
    assert.equal(projected.promptText, `${kind} task`)
    assert.equal(
      projected.sessionManager.getSessionDir(),
      await directory(created.conversation.id, turnId),
    )
  }
})

test('applies explicit delivery and silence policy to every turn family', () => {
  for (const source of ['composer', 'group-orchestrator']) {
    assert.deepEqual(resolveTurnPolicy({ source }), {
      history: 'main',
      silenceAllowed: false,
    })
  }
  for (const source of [
    'direct-agent-message',
    'routine',
    'user-reaction',
    'shell-completion',
    'browser-use-completion',
    'computer-use-completion',
    'general-subagent-completion',
  ]) {
    assert.deepEqual(resolveTurnPolicy({ source }), {
      history: 'main',
      silenceAllowed: true,
    })
  }
  assert.deepEqual(resolveTurnPolicy({ source: 'subagent' }), {
    history: 'isolated-worker',
    silenceAllowed: false,
  })
})
