import assert from 'node:assert/strict'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'

const testData = path.resolve(process.cwd(), '../../.data', `computer-tests-${process.pid}`)
await rm(testData, { recursive: true, force: true })
process.env.OPENBOT_DATA_DIR = testData

const [
  { acceptUserMessage, createAgent, listConversationMessages },
  { DesktopToolRuntime },
  { createDesktopDriver, DesktopDriverError },
  schema,
] =
  await Promise.all([
    import('@openbot/db'),
    import('./runtime'),
    import('./driver'),
    import('../tools/computer-schema'),
  ])

const display = { width: 100, height: 50, sessionId: 'test-display' }

function image(value: string) {
  return {
    dataBase64: Buffer.from(value).toString('base64'),
    mediaType: 'image/png' as const,
    width: display.width,
    height: display.height,
    cursor: { x: 2, y: 3 },
  }
}

async function turnContext(approvalMode = 'off') {
  const created = await createAgent({
    name: `Computer test ${crypto.randomUUID()}`,
    approvalMode,
  })
  const accepted = await acceptUserMessage({
    conversationId: created.conversation.id,
    text: 'Run the computer test',
    requestId: crypto.randomUUID(),
    idempotencyKey: crypto.randomUUID(),
  })
  return {
    agent: created.agent,
    conversation: created.conversation,
    turnId: accepted.turn.id,
  }
}

function runtimeOptions(
  context: Awaited<ReturnType<typeof turnContext>>,
  driver: {
    getDisplay: () => Promise<typeof display>
    captureScreenshot: () => Promise<ReturnType<typeof image>>
    execute: (
      actions: readonly unknown[],
      signal?: AbortSignal,
    ) => Promise<{ screenshot?: ReturnType<typeof image> }>
  },
  approvalMode = 'off',
) {
  return {
    driver,
    approvalMode,
    agentId: context.agent.id,
    conversationId: context.conversation.id,
    turnId: context.turnId,
    senderAgentId: null,
    signal: new AbortController().signal,
    onPersisted: () => {},
    suspend: async () => undefined,
    timeoutMs: 10_000,
  }
}

test('validates bounded sequences and dynamic desktop coordinates', () => {
  assert.equal(
    schema.computerArgsSchema.safeParse({
      action: 'type',
      text: 'x'.repeat(2_001),
    }).success,
    false,
  )
  assert.equal(
    schema.computerArgsSchema.safeParse({
      action: 'wait',
      duration_ms: 30_001,
    }).success,
    false,
  )
  const parsed = schema.computerArgsSchema.parse({ action: 'click', x: 99, y: 49 })
  const actions = schema.normalizeComputerArgs(parsed).actions
  assert.equal(schema.validateDisplayBounds(actions, display), undefined)
  assert.match(
    schema.validateDisplayBounds(actions, { ...display, width: 99 }) ?? '',
    /outside the 99×50 desktop/,
  )
})

test('executes a normalized sequence and persists its automatic final screenshot', async () => {
  const context = await turnContext()
  let executed: readonly unknown[] = []
  let executionCount = 0
  const finalImage = image('final state')
  const driver = {
    async getDisplay() {
      return display
    },
    async captureScreenshot() {
      return image('initial state')
    },
    async execute(actions: readonly unknown[]) {
      executionCount += 1
      executed = actions
      return { screenshot: finalImage }
    },
  }
  const runtime = new DesktopToolRuntime(runtimeOptions(context, driver))
  const args = schema.computerArgsSchema.parse({
    action: 'click',
    x: 10,
    y: 20,
    description: 'Open the visible menu',
    then: [{ action: 'type', text: 'hello' }],
  })

  const result = await runtime.computer('call-1', args)

  assert.equal(result.status, 'success')
  assert.deepEqual(
    executed.map((action) => (action as { action: string }).action),
    ['click', 'type', 'screenshot'],
  )
  assert.ok(result.screenshot?.fileId)
  const replayed = await runtime.computer('call-1', args)
  assert.equal(executionCount, 1)
  assert.equal(replayed.screenshot?.fileId, result.screenshot?.fileId)
  const rows = await listConversationMessages(context.conversation.id)
  const row = rows.find((candidate) => candidate.payloadJson.event === 'computer-use')
  assert.equal(row?.kind, 'tool_result')
  assert.equal(row?.attachmentsJson.items.length, 1)
  assert.ok(rows.some((candidate) => candidate.payloadJson.event === 'computer-use-progress'))
})

test('serializes mutating sequences across agents and releases the lease', async () => {
  const firstContext = await turnContext()
  const secondContext = await turnContext()
  let release!: () => void
  let entered!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const started = new Promise<void>((resolve) => {
    entered = resolve
  })
  const firstDriver = {
    async getDisplay() {
      return display
    },
    async captureScreenshot() {
      return image('shared state')
    },
    async execute() {
      entered()
      await gate
      return { screenshot: image('first finished') }
    },
  }
  let secondExecutions = 0
  const secondDriver = {
    async getDisplay() {
      return display
    },
    async captureScreenshot() {
      return image('shared state')
    },
    async execute() {
      secondExecutions += 1
      return { screenshot: image('second finished') }
    },
  }
  const args = schema.computerArgsSchema.parse({ action: 'key', key: 'ENTER' })
  const firstRuntime = new DesktopToolRuntime(runtimeOptions(firstContext, firstDriver))
  const secondRuntime = new DesktopToolRuntime(runtimeOptions(secondContext, secondDriver))

  const first = firstRuntime.computer('first-call', args)
  await started
  const busy = await secondRuntime.computer('second-call', args)
  assert.equal(busy.status, 'desktop_busy')
  assert.equal(secondExecutions, 0)

  release()
  assert.equal((await first).status, 'success')
  const afterRelease = await secondRuntime.computer('third-call', args)
  assert.equal(afterRelease.status, 'success')
  assert.equal(secondExecutions, 1)
})

test('rejects an approval when the desktop state changes', async () => {
  const context = await turnContext('allowlist')
  let currentImage = image('before review')
  let waitingState: { resumeData: unknown } | undefined
  const driver = {
    async getDisplay() {
      return display
    },
    async captureScreenshot() {
      return currentImage
    },
    async execute() {
      return { screenshot: currentImage }
    },
  }
  const options = runtimeOptions(context, driver, 'allowlist')
  const firstRuntime = new DesktopToolRuntime({
    ...options,
    suspend: async (state) => {
      waitingState = state
      return undefined
    },
  })
  const args = schema.computerArgsSchema.parse({
    action: 'click',
    x: 4,
    y: 5,
    description: 'Confirm the visible dialog',
  })
  assert.equal((await firstRuntime.computer('approval-call', args)).status, 'approval_required')
  assert.ok(waitingState)

  const approval = (waitingState!.resumeData as {
    fingerprint: string
    stateId: string
  })
  currentImage = image('changed after review')
  const resumed = new DesktopToolRuntime({ ...options, approved: approval })
  assert.equal((await resumed.computer('resumed-call', args)).status, 'stale_desktop')
})

test('normalizes driver failures and releases the desktop lease', async () => {
  const failedContext = await turnContext()
  const nextContext = await turnContext()
  const failedDriver = {
    async getDisplay() {
      return display
    },
    async captureScreenshot() {
      return image('unchanged')
    },
    async execute() {
      throw new DesktopDriverError('driver_failure', 'input daemon disconnected')
    },
  }
  const workingDriver = {
    async getDisplay() {
      return display
    },
    async captureScreenshot() {
      return image('unchanged')
    },
    async execute() {
      return { screenshot: image('complete') }
    },
  }
  const args = schema.computerArgsSchema.parse({ action: 'key', key: 'ESCAPE' })
  const failed = new DesktopToolRuntime(runtimeOptions(failedContext, failedDriver))
  const next = new DesktopToolRuntime(runtimeOptions(nextContext, workingDriver))

  assert.equal((await failed.computer('failed-call', args)).status, 'driver_failure')
  assert.equal((await next.computer('next-call', args)).status, 'success')
})

test('keeps Screenshot read-only and persists discovered dimensions and state', async () => {
  const context = await turnContext()
  let executions = 0
  const driver = {
    async getDisplay() {
      return display
    },
    async captureScreenshot() {
      return image('read only')
    },
    async execute() {
      executions += 1
      return {}
    },
  }
  const runtime = new DesktopToolRuntime(runtimeOptions(context, driver))
  const result = await runtime.screenshot('screenshot-call')

  assert.equal(result.status, 'success')
  assert.equal(result.display?.width, 100)
  assert.ok(result.screenshot?.stateId)
  assert.equal(executions, 0)
})

test('normalizes cancellation and timeout and releases their leases', async () => {
  async function runInterrupted(kind: 'cancelled' | 'timeout') {
    const context = await turnContext()
    const controller = new AbortController()
    let entered!: () => void
    const started = new Promise<void>((resolve) => {
      entered = resolve
    })
    const driver = {
      async getDisplay() {
        return display
      },
      async captureScreenshot() {
        return image(`${kind} state`)
      },
      async execute(_actions: readonly unknown[], signal?: AbortSignal) {
        entered()
        return new Promise<never>((_resolve, reject) => {
          signal?.addEventListener(
            'abort',
            () => reject(new DesktopDriverError('cancelled', 'interrupted')),
            { once: true },
          )
        })
      },
    }
    const runtime = new DesktopToolRuntime({
      ...runtimeOptions(context, driver),
      signal: controller.signal,
      timeoutMs: kind === 'timeout' ? 20 : 10_000,
    })
    const args = schema.computerArgsSchema.parse({ action: 'key', key: 'TAB' })
    const pending = runtime.computer(`${kind}-call`, args)
    await started
    if (kind === 'cancelled') controller.abort()
    assert.equal((await pending).status, kind)
  }

  await runInterrupted('cancelled')
  await runInterrupted('timeout')

  const context = await turnContext()
  const driver = {
    async getDisplay() {
      return display
    },
    async captureScreenshot() {
      return image('after interruption')
    },
    async execute() {
      return { screenshot: image('released') }
    },
  }
  const runtime = new DesktopToolRuntime(runtimeOptions(context, driver))
  const args = schema.computerArgsSchema.parse({ action: 'key', key: 'TAB' })
  assert.equal((await runtime.computer('after-interruption-call', args)).status, 'success')
})

test('turn construction tolerates malformed optional driver configuration', async () => {
  const previousDriver = process.env.OPENBOT_DESKTOP_DRIVER
  const previousArgs = process.env.OPENBOT_DESKTOP_DRIVER_ARGS
  process.env.OPENBOT_DESKTOP_DRIVER = '/configured/driver'
  process.env.OPENBOT_DESKTOP_DRIVER_ARGS = '{not-json'
  try {
    const driver = createDesktopDriver()
    await assert.rejects(
      driver.getDisplay(),
      (error: unknown) =>
        error instanceof DesktopDriverError &&
        error.code === 'desktop_unavailable' &&
        error.message.includes('OPENBOT_DESKTOP_DRIVER_ARGS'),
    )
  } finally {
    if (previousDriver === undefined) delete process.env.OPENBOT_DESKTOP_DRIVER
    else process.env.OPENBOT_DESKTOP_DRIVER = previousDriver
    if (previousArgs === undefined) delete process.env.OPENBOT_DESKTOP_DRIVER_ARGS
    else process.env.OPENBOT_DESKTOP_DRIVER_ARGS = previousArgs
  }
})
