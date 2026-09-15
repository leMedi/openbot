import assert from 'node:assert/strict'
import { rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import type { ConversationMessage, WaitingState } from '@openbot/db'
import type { BrowserRuntimeOptions } from './runtime'

const testData = path.resolve(process.cwd(), '../../.data', `browser-runtime-${process.pid}`)
await rm(testData, { recursive: true, force: true })
process.env.OPENBOT_DATA_DIR = testData

const [db, browserRuntime, desktopRuntime] = await Promise.all([
  import('@openbot/db'),
  import('./runtime'),
  import('../desktop/runtime'),
])

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
)

async function turnContext(approvalMode = 'off') {
  const created = await db.createAgent({
    name: `Browser runtime ${crypto.randomUUID()}`,
    approvalMode,
  })
  const accepted = await db.acceptUserMessage({
    conversationId: created.conversation.id,
    text: 'Run the browser test',
    requestId: crypto.randomUUID(),
    idempotencyKey: crypto.randomUUID(),
  })
  return { ...created, turnId: accepted.turn.id }
}

function options(
  context: Awaited<ReturnType<typeof turnContext>>,
  overrides: Partial<BrowserRuntimeOptions> = {},
): BrowserRuntimeOptions {
  return {
    display: 7,
    approvalMode: context.agent.approvalMode,
    agentId: context.agent.id,
    conversationId: context.conversation.id,
    turnId: context.turnId,
    senderAgentId: null,
    signal: new AbortController().signal,
    onPersisted: () => {},
    suspend: async () => undefined,
    capturePageState: async () => ({ targets: [{ id: 'page-1', url: 'https://before.test' }], views: {} }),
    ...overrides,
  }
}

test('passes only trusted browser configuration, persists a PNG, and deduplicates completion', async () => {
  const context = await turnContext()
  let calls = 0
  let request: Record<string, unknown> | undefined
  let driverOptions: Record<string, unknown> | undefined
  const runtime = new browserRuntime.BrowserToolRuntime(options(context, {
    runOperation: async (input, suppliedOptions) => {
      calls += 1
      request = input as unknown as Record<string, unknown>
      driverOptions = suppliedOptions as Record<string, unknown>
      await writeFile(input.screenshotPath!, png)
      return {
        ok: true,
        summary: 'Navigated to https://example.com',
        viewId: input.viewId,
        url: 'https://example.com/',
        title: 'Example Domain',
        screenshot: true,
      }
    },
  }))

  const result = await runtime.execute('call_navigate', 'browser_navigate', {
    url: 'https://example.com',
  })
  assert.equal(result.status, 'success')
  assert.equal(result.screenshot?.mediaType, 'image/png')
  assert.equal(result.screenshot?.width, 1)
  assert.equal(result.screenshot?.height, 1)
  assert.equal(request?.display, 7)
  assert.equal(request?.cdpPort, 9229)
  assert.equal(request?.viewId, context.conversation.id)
  assert.match(String(request?.screenshotPath), /^\/tmp\/\.browser\//)
  assert.equal(
    driverOptions?.sharedCookiesPath,
    path.join(testData, 'browser', 'shared-cookies.json'),
  )
  assert.equal('display' in (result as unknown as Record<string, unknown>), false)

  const replayed = await runtime.execute('call_navigate', 'browser_navigate', {
    url: 'https://example.com',
  })
  assert.equal(calls, 1)
  assert.equal(replayed.screenshot?.fileId, result.screenshot?.fileId)

  const invalid = await runtime.execute('call_invalid', 'browser_navigate', {
    url: 'https://example.com',
    display: 99,
  })
  assert.equal(invalid.status, 'invalid_input')
  assert.equal(calls, 1)

  const rows = await db.listConversationMessages(context.conversation.id)
  assert.ok(rows.some((row) => row.payloadJson.event === 'browser-use-progress'))
  const completed = rows.find((row) => row.payloadJson.event === 'browser-use')
  assert.equal(completed?.kind, 'tool_result')
  assert.equal(completed?.attachmentsJson.items.length, 1)
})

test('applies Grok review categories and resumes only an exact one-shot approval', async () => {
  const context = await turnContext('allowlist')
  let waiting: WaitingState | undefined
  let calls = 0
  const runtimeOptions = options(context, {
    runOperation: async (input) => {
      calls += 1
      await writeFile(input.screenshotPath!, png)
      return { ok: true, summary: 'Clicked the control', screenshot: true }
    },
    suspend: async (state) => {
      waiting = state
      return undefined
    },
  })
  const runtime = new browserRuntime.BrowserToolRuntime(runtimeOptions)

  assert.equal(
    (await runtime.execute('missing_description', 'browser_click', { ref: 'e1' })).status,
    'invalid_input',
  )
  const pending = await runtime.execute('approval_call', 'browser_click', {
    ref: 'e1',
    element: 'Open the requested record',
  })
  assert.equal(pending.status, 'approval_required')
  assert.equal(calls, 0)
  assert.deepEqual(waiting?.options.map((option) => option.label), ['Allow once', 'Deny'])

  const approvedState = {
    ...waiting!,
    response: {
      optionId: 'approve',
      text: 'Allow once',
      dismissed: false,
      requestId: 'request_approval',
      idempotencyKey: 'approval_once',
      respondedAt: Date.now(),
    },
  }
  const approval = browserRuntime.browserApprovalFromWaitingState(approvedState)
  assert.ok(approval)
  const resumed = new browserRuntime.BrowserToolRuntime({ ...runtimeOptions, approved: approval })
  assert.equal((await resumed.execute('approved_call', 'browser_click', {
    ref: 'e1',
    element: 'Open the requested record',
  })).status, 'success')
  assert.equal(calls, 1)
  assert.equal((await resumed.execute('next_approval', 'browser_click', {
    ref: 'e2',
    element: 'Open the next requested record',
  })).status, 'approval_required')
  assert.equal(calls, 1)

  const bypass = new browserRuntime.BrowserToolRuntime(options(context, {
    runOperation: async (input) => {
      calls += 1
      await writeFile(input.screenshotPath!, png)
      return {
        ok: true,
        summary: 'Captured snapshot',
        data: '[ref=e1] button',
        screenshot: true,
      }
    },
    suspend: async () => {
      throw new Error('snapshot must bypass review')
    },
  }))
  assert.equal((await bypass.execute('snapshot_call', 'browser_snapshot', {})).status, 'success')
  assert.equal(calls, 2)
})

test('uses classifier decisions in enforce mode and falls back to one-shot approval', async () => {
  const allowedContext = await turnContext('allowlist')
  let allowedCalls = 0
  const allowed = new browserRuntime.BrowserToolRuntime(options(allowedContext, {
    review: async () => ({
      kind: 'allow',
      reason: 'The task explicitly requests this navigation.',
      model: 'provider/orchestrator',
    }),
    runOperation: async (input) => {
      allowedCalls += 1
      await writeFile(input.screenshotPath!, png)
      return { ok: true, summary: 'Navigated', screenshot: true }
    },
  }))
  assert.equal((await allowed.execute('classified_allow', 'browser_navigate', {
    url: 'https://example.com',
  })).status, 'success')
  assert.equal(allowedCalls, 1)
  const audit = (await db.listConversationMessages(allowedContext.conversation.id)).find(
    (row) => row.payloadJson.event === 'browser-use-audit' &&
      row.payloadJson.toolCallId === 'classified_allow' &&
      row.payloadJson.stage === 'review_decision',
  )
  assert.equal(audit?.payloadJson.reviewerModel, 'provider/orchestrator')

  for (const kind of ['block', 'reject'] as const) {
    const blockedContext = await turnContext('allowlist')
    let waiting: WaitingState | undefined
    const blocked = new browserRuntime.BrowserToolRuntime(options(blockedContext, {
      review: async () => ({
        kind,
        reason: kind === 'block' ? 'The action is not clearly authorized.' : 'Classifier failed.',
        model: 'provider/orchestrator',
      }),
      suspend: async (state) => {
        waiting = state
        return undefined
      },
    }))
    assert.equal((await blocked.execute(`classified_${kind}`, 'browser_click', {
      ref: 'e1',
      element: 'Submit the form',
    })).status, 'approval_required')
    assert.match(waiting?.helpText ?? '', kind === 'block' ? /not clearly authorized/ : /Classifier failed/)
  }
})

test('blocks browser operations while the Remote Desktop is handed to the user', async () => {
  const context = await turnContext('off')
  let calls = 0
  const runtime = new browserRuntime.BrowserToolRuntime(options(context, {
    isAutomationBlocked: async () => true,
    runOperation: async () => {
      calls += 1
      return { ok: true, summary: 'Unexpected operation' }
    },
  }))
  const result = await runtime.execute('blocked_handoff', 'browser_snapshot', {})
  assert.equal(result.status, 'browser_busy')
  assert.match(result.summary, /handed to the user/)
  assert.equal(calls, 0)
})

test('rechecks a new desktop handoff after classifier review', async () => {
  const context = await turnContext('allowlist')
  let handoffChecks = 0
  let operationCalls = 0
  const runtime = new browserRuntime.BrowserToolRuntime(options(context, {
    isAutomationBlocked: async () => {
      handoffChecks += 1
      return handoffChecks > 1
    },
    review: async () => ({
      kind: 'allow',
      reason: 'The action is explicitly requested.',
      model: 'provider/orchestrator',
    }),
    runOperation: async () => {
      operationCalls += 1
      return { ok: true, summary: 'Unexpected operation' }
    },
  }))
  const result = await runtime.execute('handoff_after_review', 'browser_click', {
    ref: 'e1',
    element: 'Requested listing',
  })
  assert.equal(result.status, 'browser_busy')
  assert.equal(operationCalls, 0)
  assert.equal(handoffChecks, 2)
})

test('refuses any further mutation after an unsettled execution audit', async () => {
  const context = await turnContext()
  await db.appendConversationMessage({
    conversationId: context.conversation.id,
    turnId: context.turnId,
    senderAgentId: null,
    kind: 'status',
    direction: 'internal',
    bodyText: 'Execution started',
    payload: db.browserUsePayloadSchema.parse({
      version: 1,
      event: 'browser-use-audit',
      toolCallId: 'unknown_call',
      name: 'browser_navigate',
      fingerprint: 'fingerprint',
      stage: 'execution_started',
      summary: 'Execution started',
    }),
  })
  let calls = 0
  const runtime = new browserRuntime.BrowserToolRuntime(options(context, {
    runOperation: async () => {
      calls += 1
      return { ok: true, summary: 'Unexpected replay' }
    },
  }))
  const result = await runtime.execute('new_call_after_restart', 'browser_navigate', {
    url: 'https://example.com',
  })
  assert.equal(result.status, 'unknown_outcome')
  assert.equal(calls, 0)
})

test('shares the x11 automation lease with DesktopToolRuntime', async () => {
  const browserContext = await turnContext()
  const desktopContext = await turnContext()
  let entered!: () => void
  let release!: () => void
  const started = new Promise<void>((resolve) => { entered = resolve })
  const gate = new Promise<void>((resolve) => { release = resolve })
  const browser = new browserRuntime.BrowserToolRuntime(options(browserContext, {
    runOperation: async (input) => {
      entered()
      await gate
      await writeFile(input.screenshotPath!, png)
      return { ok: true, summary: 'Captured snapshot', screenshot: true }
    },
  }))
  const pending = browser.execute('lease_browser', 'browser_snapshot', {})
  await started

  let desktopCalls = 0
  const desktop = new desktopRuntime.DesktopToolRuntime({
    driver: {
      async getDisplay() {
        desktopCalls += 1
        return { width: 100, height: 50, sessionId: 'x11:7' }
      },
      async captureScreenshot() {
        throw new Error('must not capture while browser owns the lease')
      },
      async execute() { return {} },
    },
    leaseKey: 'x11:7',
    approvalMode: 'off',
    agentId: desktopContext.agent.id,
    conversationId: desktopContext.conversation.id,
    turnId: desktopContext.turnId,
    senderAgentId: null,
    signal: new AbortController().signal,
    onPersisted: (_message: ConversationMessage) => {},
    suspend: async () => undefined,
  })
  assert.equal((await desktop.screenshot('lease_desktop')).status, 'desktop_busy')
  assert.equal(desktopCalls, 0)
  release()
  assert.equal((await pending).status, 'success')
})
