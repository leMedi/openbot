import { createHash, randomUUID } from 'node:crypto'
import { readFile, unlink } from 'node:fs/promises'
import path from 'node:path'
import {
  runBrowserOperation,
  type BrowserOperationResult,
} from '@openbot/browser-driver'
import {
  appendConversationMessage,
  browserToolNameSchema,
  browserUsePayloadSchema,
  createManagedFile,
  dataDirectory,
  type ConversationMessage,
  listConversationMessages,
  type SendMessagePayload,
  type WaitingState,
} from '@openbot/db'
import * as z from 'zod'
import {
  releaseAutomationLease,
  tryAcquireAutomationLease,
  x11AutomationLeaseKey,
} from '../automation/lease'
import {
  browserOperationRequest,
  browserToolArgsSchemas,
  type BrowserToolArgs,
  type BrowserToolName,
} from '../tools/browser'

export type BrowserOutcome =
  | 'success'
  | 'invalid_input'
  | 'approval_required'
  | 'review_blocked'
  | 'stale_browser'
  | 'browser_unavailable'
  | 'browser_busy'
  | 'timeout'
  | 'cancelled'
  | 'driver_failure'
  | 'unknown_outcome'

export type BrowserApproval = {
  fingerprint: string
  stateId: string
}

export type BrowserResult = {
  ok: boolean
  status: BrowserOutcome
  summary: string
  data?: string
  viewId?: string
  url?: string
  title?: string
  fingerprint?: string
  stateId?: string
  screenshot?: {
    fileId: string
    url: string
    mediaType: 'image/png'
    width?: number
    height?: number
  }
}

type BrowserOperationRunner = typeof runBrowserOperation

export type BrowserRuntimeOptions = {
  display: number
  approvalMode: string
  agentId: string
  conversationId: string
  turnId: string
  senderAgentId: string | null
  signal: AbortSignal
  approved?: BrowserApproval
  onPersisted: (message: ConversationMessage) => void
  suspend: (
    state: WaitingState,
    delivery: { bodyText: string; payload: SendMessagePayload },
  ) => Promise<ConversationMessage | undefined>
  runOperation?: BrowserOperationRunner
  capturePageState?: (signal: AbortSignal) => Promise<unknown>
  recoveredAt?: number
}

const bypassedReview = new Set<BrowserToolName>([
  'browser_snapshot',
  'browser_take_screenshot',
  'browser_get_bounding_box',
  'browser_highlight',
  'browser_scroll',
])

function isMutating(name: BrowserToolName, args: BrowserToolArgs) {
  if (bypassedReview.has(name)) return false
  if (name !== 'browser_tabs') return true
  const action = (args as { action: string }).action
  return action === 'new' || action === 'close'
}

function expectsScreenshot(name: BrowserToolName, args: BrowserToolArgs) {
  if (name !== 'browser_tabs') return true
  const action = (args as { action: string }).action
  return action === 'new' || action === 'select'
}

function operationSummary(name: BrowserToolName, args: BrowserToolArgs) {
  const description = 'element' in args && typeof args.element === 'string'
    ? ` (${args.element})`
    : ''
  if (name === 'browser_navigate') return `navigate to ${(args as { url: string }).url}`
  if (name === 'browser_tabs') {
    const tab = args as { action: string; index?: number }
    return `${tab.action} ${tab.index === undefined ? 'the current browser tab' : `browser tab ${String(tab.index)}`}`
  }
  if (name === 'browser_press_key') return `press ${(args as { key: string }).key}`
  if (name === 'browser_cdp') return `run CDP method ${(args as { method: string }).method}`
  if (name === 'browser_type') {
    return `type${(args as { submit?: boolean }).submit ? ' and submit' : ''}${description}`
  }
  return `${name.replace('browser_', '').replaceAll('_', ' ')}${description}`
}

function reviewedDescriptionError(name: BrowserToolName, args: BrowserToolArgs) {
  if (![
    'browser_click',
    'browser_mouse_click_xy',
    'browser_drag',
    'browser_type',
    'browser_fill',
    'browser_select_option',
  ].includes(name)) {
    return undefined
  }
  return 'element' in args && typeof args.element === 'string' && args.element.trim()
    ? undefined
    : `${name} requires a concise element description when reviewed`
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, canonical(nested)]),
  )
}

function digest(value: unknown) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')
}

function pngDimensions(bytes: Buffer) {
  if (
    bytes.length < 24 ||
    bytes.subarray(0, 8).compare(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) !== 0
  ) {
    return undefined
  }
  const width = bytes.readUInt32BE(16)
  const height = bytes.readUInt32BE(20)
  return width > 0 && height > 0 ? { width, height } : undefined
}

function safeSummary(status: BrowserOutcome, summary: string) {
  return status === 'success' ? summary : `${status.replaceAll('_', ' ')}: ${summary}`
}

function redactTrustedConfiguration(
  message: string,
  trusted: { display: number; cdpPort: number; screenshotPath: string; sharedCookiesPath: string },
) {
  return message
    .replaceAll(trusted.screenshotPath, '[temporary browser screenshot]')
    .replaceAll(trusted.sharedCookiesPath, '[browser cookie store]')
    .replaceAll(String(trusted.cdpPort), '[browser endpoint]')
    .replace(
      new RegExp(`(display\\s*:?\\s*)${String(trusted.display)}\\b`, 'gi'),
      '$1[browser display]',
    )
}

export class BrowserToolRuntime {
  private readonly runOperation: BrowserOperationRunner
  private approved: BrowserApproval | undefined

  constructor(private readonly options: BrowserRuntimeOptions) {
    this.runOperation = options.runOperation ?? runBrowserOperation
    this.approved = options.approved
  }

  private async priorResult(toolCallId: string): Promise<BrowserResult | undefined> {
    const rows = await listConversationMessages(this.options.conversationId)
    const row = rows.find(
      (candidate) =>
        candidate.turnId === this.options.turnId &&
        candidate.payloadJson.event === 'browser-use' &&
        candidate.payloadJson.toolCallId === toolCallId,
    )
    if (!row) return undefined
    const parsed = browserUsePayloadSchema.safeParse(row.payloadJson)
    if (!parsed.success || parsed.data.event !== 'browser-use') return undefined
    return {
      ok: parsed.data.status === 'success',
      status: parsed.data.outcome,
      summary: parsed.data.detail,
      ...(parsed.data.data !== undefined && { data: parsed.data.data }),
      ...(parsed.data.viewId && { viewId: parsed.data.viewId }),
      ...(parsed.data.url !== undefined && { url: parsed.data.url }),
      ...(parsed.data.title !== undefined && { title: parsed.data.title }),
      ...(parsed.data.fingerprint && { fingerprint: parsed.data.fingerprint }),
      ...(parsed.data.stateId && { stateId: parsed.data.stateId }),
      ...(parsed.data.screenshot && { screenshot: parsed.data.screenshot }),
    }
  }

  private async hasUnsettledExecution() {
    const rows = await listConversationMessages(this.options.conversationId)
    const completed = new Set(
      rows
        .filter((candidate) =>
          candidate.turnId === this.options.turnId &&
          candidate.payloadJson.event === 'browser-use' &&
          candidate.payloadJson.outcome === 'success')
        .map((candidate) => candidate.payloadJson.toolCallId),
    )
    return rows.some(
      (candidate) =>
        candidate.turnId === this.options.turnId &&
        candidate.payloadJson.event === 'browser-use-audit' &&
        candidate.payloadJson.stage === 'execution_started' &&
        !completed.has(candidate.payloadJson.toolCallId),
    )
  }

  private async hasPriorExecution(recoveredAt: number) {
    const rows = await listConversationMessages(this.options.conversationId)
    return rows.some((candidate) =>
      candidate.turnId === this.options.turnId &&
      candidate.createdAt <= recoveredAt &&
      candidate.payloadJson.event === 'browser-use-audit' &&
      candidate.payloadJson.stage === 'execution_started')
  }

  private async capturePageState(signal: AbortSignal, viewId?: string) {
    if (this.options.capturePageState) return this.options.capturePageState(signal)
    const cdpPort = 9222 + this.options.display
    const sharedCookiesPath = path.join(dataDirectory, 'browser', 'shared-cookies.json')
    const screenshotPath = path.join(
      '/tmp/.browser',
      `review-${digest(`${this.options.turnId}:${randomUUID()}`).slice(0, 24)}.png`,
    )
    let pageDigest: string | undefined
    try {
      const result = await this.runOperation(
        {
          op: 'screenshot',
          display: this.options.display,
          cdpPort,
          viewId: viewId ?? this.options.conversationId,
          screenshotPath,
          fullPage: true,
        },
        { signal, sharedCookiesPath },
      )
      if (!result.ok) throw new Error(result.error)
      if (!result.screenshot) throw new Error('Browser state screenshot was not captured')
      pageDigest = createHash('sha256').update(await readFile(screenshotPath)).digest('hex')
    } finally {
      await unlink(screenshotPath).catch(() => {})
    }
    let targets: Array<Record<string, unknown>> = []
    let views: Record<string, unknown> = {}
    try {
      const response = await fetch(`http://127.0.0.1:${String(cdpPort)}/json/list`, {
        signal: AbortSignal.any([signal, AbortSignal.timeout(1_500)]),
      })
      const parsed: unknown = response.ok ? await response.json() : []
      if (Array.isArray(parsed)) {
        targets = parsed.filter(
          (target): target is Record<string, unknown> =>
            !!target && typeof target === 'object' && !Array.isArray(target),
        )
      }
    } catch {
      // A first navigation may legitimately start Chrome after this review snapshot.
    }
    try {
      const parsed: unknown = JSON.parse(
        await readFile(`/tmp/.browser/views-${String(this.options.display)}.json`, 'utf8'),
      )
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        views = parsed as Record<string, unknown>
      }
    } catch {
      // No view map exists before this agent's first browser operation.
    }
    const pageIdentity = targets
      .filter((target) => target.type === 'page' && typeof target.id === 'string')
      .map((target) => `${String(target.id)}\t${typeof target.url === 'string' ? target.url.trim() : ''}`)
      .sort()
    const mappedViews = views.views && typeof views.views === 'object' && !Array.isArray(views.views)
      ? views.views as Record<string, unknown>
      : {}
    const targetId = mappedViews[this.options.conversationId]
    const targetPageUrl = typeof targetId === 'string'
      ? targets.find((target) => target.id === targetId)?.url
      : undefined
    return {
      pageIdentity,
      ...(typeof targetPageUrl === 'string' && { targetPageUrl }),
      ...(pageDigest && { pageDigest }),
    }
  }

  private fingerprint(name: BrowserToolName, args: BrowserToolArgs, stateId: string) {
    return digest({
      version: 1,
      name,
      args,
      agentId: this.options.agentId,
      conversationId: this.options.conversationId,
      turnId: this.options.turnId,
      display: this.options.display,
      stateId,
    })
  }

  private async audit(
    toolCallId: string,
    name: BrowserToolName,
    fingerprint: string,
    stage: 'review_decision' | 'execution_started',
    summary: string,
    decision?: 'allowed' | 'blocked' | 'approval_required' | 'approved',
  ) {
    const payload = browserUsePayloadSchema.parse({
      version: 1,
      event: 'browser-use-audit',
      toolCallId,
      name,
      fingerprint,
      stage,
      ...(decision && { decision }),
      summary,
    })
    await appendConversationMessage({
      conversationId: this.options.conversationId,
      turnId: this.options.turnId,
      senderAgentId: this.options.senderAgentId,
      kind: 'status',
      direction: 'internal',
      bodyText: summary,
      payload,
    })
  }

  private async progress(
    toolCallId: string,
    name: BrowserToolName,
    fingerprint: string,
    summary: string,
  ) {
    const message = await appendConversationMessage({
      conversationId: this.options.conversationId,
      turnId: this.options.turnId,
      senderAgentId: this.options.senderAgentId,
      kind: 'status',
      direction: 'outbound',
      bodyText: `Browser: ${summary}`,
      payload: browserUsePayloadSchema.parse({
        version: 1,
        event: 'browser-use-progress',
        toolCallId,
        name,
        preview: summary,
        status: 'pending',
        fingerprint,
      }),
    })
    this.options.onPersisted(message)
  }

  private async persist(
    toolCallId: string,
    name: BrowserToolName,
    result: BrowserResult,
    screenshotPath?: string,
  ) {
    let screenshot: BrowserResult['screenshot']
    let attachment:
      | { fileId: string; name: string; mediaType: 'image/png'; byteSize: number }
      | undefined
    if (screenshotPath) {
      try {
        const bytes = await readFile(screenshotPath)
        if (bytes.byteLength > 25 * 1024 * 1024) throw new Error('Browser screenshot exceeds 25 MB')
        const file = await createManagedFile({
          bytes,
          originalName: `browser-${Date.now()}.png`,
          mediaType: 'image/png',
          subdirectory: `browser/${this.options.conversationId}`,
        })
        const dimensions = pngDimensions(bytes)
        screenshot = {
          fileId: file.id,
          url: `/api/files/${file.id}`,
          mediaType: 'image/png',
          ...(dimensions ?? {}),
        }
        attachment = {
          fileId: file.id,
          name: file.originalName,
          mediaType: 'image/png',
          byteSize: file.byteSize,
        }
      } finally {
        await unlink(screenshotPath).catch(() => {})
      }
    }
    const finalResult = screenshot ? { ...result, screenshot } : result
    const payload = browserUsePayloadSchema.parse({
      version: 1,
      event: 'browser-use',
      toolCallId,
      name,
      preview: finalResult.summary,
      status: finalResult.ok ? 'success' : 'failed',
      outcome: finalResult.status,
      detail: finalResult.summary,
      ...(finalResult.data !== undefined && { data: finalResult.data }),
      ...(finalResult.viewId && { viewId: finalResult.viewId }),
      ...(finalResult.url !== undefined && { url: finalResult.url }),
      ...(finalResult.title !== undefined && { title: finalResult.title }),
      ...(finalResult.fingerprint && { fingerprint: finalResult.fingerprint }),
      ...(finalResult.stateId && { stateId: finalResult.stateId }),
      ...(screenshot && { screenshot }),
    })
    const message = await appendConversationMessage({
      conversationId: this.options.conversationId,
      turnId: this.options.turnId,
      senderAgentId: this.options.senderAgentId,
      kind: 'tool_result',
      role: 'tool',
      direction: 'outbound',
      bodyText: safeSummary(finalResult.status, finalResult.summary),
      payload,
      ...(attachment && {
        attachments: {
          version: 1,
          items: [{
            fileId: attachment.fileId,
            position: 0,
            metadata: {
              name: attachment.name,
              mediaType: attachment.mediaType,
              byteSize: attachment.byteSize,
            },
          }],
        },
      }),
    })
    this.options.onPersisted(message)
    return finalResult
  }

  private async runTrustedOperation(
    toolCallId: string,
    name: BrowserToolName,
    args: BrowserToolArgs,
    fingerprint?: string,
    stateId?: string,
  ) {
    const screenshotPath = path.join(
      '/tmp/.browser',
      `openbot-${digest(`${this.options.turnId}:${toolCallId}:${randomUUID()}`).slice(0, 24)}.png`,
    )
    const sharedCookiesPath = path.join(dataDirectory, 'browser', 'shared-cookies.json')
    let output: BrowserOperationResult
    try {
      output = await this.runOperation(
        browserOperationRequest(name, args, {
          display: this.options.display,
          cdpPort: 9222 + this.options.display,
          viewId: this.options.conversationId,
          screenshotPath,
        }),
        {
          signal: this.options.signal,
          sharedCookiesPath,
        },
      )
    } catch (error) {
      output = {
        ok: false,
        error: error instanceof Error ? error.message : 'Browser driver failed',
        code: 'driver_failure',
      }
    }
    if (!output.ok) {
      const status: BrowserOutcome = fingerprint
        ? 'unknown_outcome'
        : output.code === 'timeout'
        ? 'timeout'
        : output.code === 'cancelled' || this.options.signal.aborted
          ? 'cancelled'
          : output.code === 'invalid_request'
            ? 'invalid_input'
            : 'driver_failure'
      await unlink(screenshotPath).catch(() => {})
      return this.persist(toolCallId, name, {
        ok: false,
        status,
        summary: redactTrustedConfiguration(output.error, {
          display: this.options.display,
          cdpPort: 9222 + this.options.display,
          screenshotPath,
          sharedCookiesPath,
        }),
        ...(fingerprint && { fingerprint }),
        ...(stateId && { stateId }),
      })
    }
    if (
      !output.screenshot &&
      expectsScreenshot(name, args)
    ) {
      await unlink(screenshotPath).catch(() => {})
      return this.persist(toolCallId, name, {
        ok: false,
        status: fingerprint ? 'unknown_outcome' : 'driver_failure',
        summary: fingerprint
          ? 'The browser action completed, but its resulting page could not be captured'
          : 'The requested browser screenshot was not captured',
        ...(fingerprint && { fingerprint }),
        ...(stateId && { stateId }),
      })
    }
    if (!output.screenshot) await unlink(screenshotPath).catch(() => {})
    return this.persist(
      toolCallId,
      name,
      {
        ok: true,
        status: 'success',
        summary: output.summary,
        ...(output.data !== undefined && { data: output.data }),
        ...(output.viewId && { viewId: output.viewId }),
        ...(output.url !== undefined && { url: output.url }),
        ...(output.title !== undefined && { title: output.title }),
        ...(fingerprint && { fingerprint }),
        ...(stateId && { stateId }),
      },
      output.screenshot ? screenshotPath : undefined,
    )
  }

  async execute(toolCallId: string, requestedName: string, rawArgs: unknown): Promise<BrowserResult> {
    const prior = await this.priorResult(toolCallId)
    if (prior) return prior
    const parsedName = browserToolNameSchema.safeParse(requestedName)
    if (!parsedName.success) {
      return {
        ok: false,
        status: 'invalid_input',
        summary: `Unknown browser tool: ${requestedName}`,
      }
    }
    const name = parsedName.data
    const parsed = browserToolArgsSchemas[name].safeParse(rawArgs)
    if (!parsed.success) {
      return this.persist(toolCallId, name, {
        ok: false,
        status: 'invalid_input',
        summary: z.prettifyError(parsed.error),
      })
    }
    const args = parsed.data as BrowserToolArgs
    const mutating = isMutating(name, args)
    const requestedViewId = 'viewId' in args && typeof args.viewId === 'string'
      ? args.viewId
      : undefined
    const descriptionError = mutating && !['off', 'shadow'].includes(this.options.approvalMode)
      ? reviewedDescriptionError(name, args)
      : undefined
    if (descriptionError) {
      return this.persist(toolCallId, name, {
        ok: false,
        status: 'invalid_input',
        summary: descriptionError,
      })
    }
    if (
      mutating &&
      (await this.hasUnsettledExecution() ||
        (this.options.recoveredAt !== undefined &&
          await this.hasPriorExecution(this.options.recoveredAt)))
    ) {
      return this.persist(toolCallId, name, {
        ok: false,
        status: 'unknown_outcome',
        summary: 'A previous browser mutation may already have taken effect before recovery; no further mutation was attempted',
      })
    }

    const leaseKey = x11AutomationLeaseKey(this.options.display)
    const summary = operationSummary(name, args)
    if (!mutating) {
      const owner = `${this.options.turnId}:${toolCallId}:browser`
      if (!tryAcquireAutomationLease(leaseKey, owner)) {
        return this.persist(toolCallId, name, {
          ok: false,
          status: 'browser_busy',
          summary: 'Another agent is currently automating this Remote Desktop',
        })
      }
      try {
        return await this.runTrustedOperation(toolCallId, name, args)
      } finally {
        releaseAutomationLease(leaseKey, owner)
      }
    }

    const reviewOwner = `${this.options.turnId}:${toolCallId}:browser-review`
    if (!tryAcquireAutomationLease(leaseKey, reviewOwner)) {
      return this.persist(toolCallId, name, {
        ok: false,
        status: 'browser_busy',
        summary: 'Another agent is currently automating this Remote Desktop',
      })
    }
    let state: unknown
    try {
      state = await this.capturePageState(this.options.signal, requestedViewId)
    } catch (error) {
      return this.persist(toolCallId, name, {
        ok: false,
        status: this.options.signal.aborted ? 'cancelled' : 'browser_unavailable',
        summary: error instanceof Error ? error.message : 'Could not capture browser state',
      })
    } finally {
      releaseAutomationLease(leaseKey, reviewOwner)
    }
    const stateId = digest(state)
    const fingerprint = this.fingerprint(name, args, stateId)
    const hasApproval =
      this.approved?.fingerprint === fingerprint && this.approved.stateId === stateId
    if (this.approved && !hasApproval) {
      this.approved = undefined
      await this.audit(toolCallId, name, fingerprint, 'review_decision', 'Rejected stale one-shot browser approval', 'blocked')
      return this.persist(toolCallId, name, {
        ok: false,
        status: 'stale_browser',
        summary: 'The approved browser action or page state changed; inspect the page and review again',
        fingerprint,
        stateId,
      })
    }
    if (hasApproval) this.approved = undefined
    const automaticallyAllowed =
      this.options.approvalMode === 'off' || this.options.approvalMode === 'shadow'
    if (!automaticallyAllowed && !hasApproval) {
      const waiting: WaitingState = {
        version: 1,
        interactionKind: 'approval',
        prompt: `Allow the browser worker to ${summary}?`,
        helpText: 'This browser action can change content or navigation in the persistent browser.',
        options: [
          { id: 'approve', label: 'Allow once', style: 'primary' },
          { id: 'deny', label: 'Deny', style: 'danger' },
        ],
        allowCustom: false,
        dismissOnMoveOn: false,
        originatingToolCall: { id: toolCallId, name },
        resumeData: { version: 1, kind: 'browser-approval', fingerprint, stateId },
        response: null,
      }
      await this.audit(toolCallId, name, fingerprint, 'review_decision', waiting.helpText!, 'approval_required')
      await this.options.suspend(waiting, {
        bodyText: waiting.prompt,
        payload: {
          version: 1,
          deliveryKind: 'send-message',
          type: 'widget',
          toolCallId,
          widget: {
            prompt: waiting.prompt,
            helpText: waiting.helpText,
            interactionKind: 'approval',
            options: waiting.options,
            allowCustom: false,
            dismissOnMoveOn: false,
          },
        },
      })
      return {
        ok: false,
        status: 'approval_required',
        summary: waiting.helpText!,
        fingerprint,
        stateId,
      }
    }
    await this.audit(
      toolCallId,
      name,
      fingerprint,
      'review_decision',
      hasApproval ? 'Allowed by one-shot browser approval' : `Allowed by approval mode: ${this.options.approvalMode}`,
      hasApproval ? 'approved' : 'allowed',
    )

    const owner = `${this.options.turnId}:${toolCallId}:browser`
    if (!tryAcquireAutomationLease(leaseKey, owner)) {
      return this.persist(toolCallId, name, {
        ok: false,
        status: 'browser_busy',
        summary: 'Another agent is currently automating this Remote Desktop',
        fingerprint,
        stateId,
      })
    }
    try {
      let currentStateId: string
      try {
        currentStateId = digest(
          await this.capturePageState(this.options.signal, requestedViewId),
        )
      } catch (error) {
        return this.persist(toolCallId, name, {
          ok: false,
          status: this.options.signal.aborted ? 'cancelled' : 'browser_unavailable',
          summary: error instanceof Error ? error.message : 'Could not verify browser state',
          fingerprint,
          stateId,
        })
      }
      const currentFingerprint = this.fingerprint(name, args, currentStateId)
      if (currentStateId !== stateId || currentFingerprint !== fingerprint) {
        return this.persist(toolCallId, name, {
          ok: false,
          status: 'stale_browser',
          summary: 'The browser page state changed between review and execution',
          fingerprint,
          stateId,
        })
      }
      await this.audit(toolCallId, name, fingerprint, 'execution_started', `Executing: ${summary}`)
      await this.progress(toolCallId, name, fingerprint, summary)
      return await this.runTrustedOperation(toolCallId, name, args, fingerprint, stateId)
    } finally {
      releaseAutomationLease(leaseKey, owner)
    }
  }
}

export function browserApprovalFromWaitingState(state: WaitingState | undefined) {
  const toolName = browserToolNameSchema.safeParse(state?.originatingToolCall.name)
  if (
    state?.interactionKind !== 'approval' ||
    state.response?.optionId !== 'approve' ||
    !toolName.success ||
    !state.resumeData ||
    typeof state.resumeData !== 'object' ||
    Array.isArray(state.resumeData)
  ) {
    return undefined
  }
  const data = state.resumeData as Record<string, unknown>
  return data.kind === 'browser-approval' &&
    typeof data.fingerprint === 'string' &&
    typeof data.stateId === 'string'
    ? { fingerprint: data.fingerprint, stateId: data.stateId }
    : undefined
}
