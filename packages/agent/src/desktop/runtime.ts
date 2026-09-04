import { createHash } from 'node:crypto'
import {
  appendConversationMessage,
  computerUsePayloadSchema,
  createManagedFile,
  type ConversationMessage,
  listConversationMessages,
  type SendMessagePayload,
  type WaitingState,
} from '@openbot/db'
import * as z from 'zod'
import {
  actionSummary,
  type ComputerArgs,
  normalizeComputerArgs,
  REVIEWED_ACTIONS,
  SCREEN_CHANGING_ACTIONS,
  validateDisplayBounds,
} from '../tools/computer-schema'
import {
  type DesktopAction,
  type DesktopDisplay,
  type DesktopDriver,
  DesktopDriverError,
  type DesktopScreenshot,
} from './driver'

export type ComputerOutcome =
  | 'success'
  | 'invalid_input'
  | 'approval_required'
  | 'review_blocked'
  | 'stale_desktop'
  | 'desktop_unavailable'
  | 'desktop_busy'
  | 'timeout'
  | 'cancelled'
  | 'driver_failure'

export type DesktopReviewTarget = {
  fingerprint: string
  agentId: string
  conversationId: string
  turnId: string
  display: DesktopDisplay
  stateId: string
  actions: readonly DesktopAction[]
}

export type DesktopReviewDecision =
  | { decision: 'allow'; reason?: string }
  | { decision: 'approval'; reason: string }
  | { decision: 'block'; reason: string }

export interface DesktopReviewer {
  review(target: DesktopReviewTarget): Promise<DesktopReviewDecision>
}

export type DesktopReviewerFactory = (approvalMode: string) => DesktopReviewer

class ApprovalModeDesktopReviewer implements DesktopReviewer {
  constructor(private readonly approvalMode: string) {}

  async review(target: DesktopReviewTarget): Promise<DesktopReviewDecision> {
    if (!target.actions.some((action) => REVIEWED_ACTIONS.has(action.action))) {
      return { decision: 'allow' }
    }
    if (this.approvalMode === 'off' || this.approvalMode === 'shadow') {
      return { decision: 'allow', reason: `approval mode: ${this.approvalMode}` }
    }
    return {
      decision: 'approval',
      reason: 'This action can change content on the Remote Desktop',
    }
  }
}

let reviewerFactory: DesktopReviewerFactory =
  (approvalMode) => new ApprovalModeDesktopReviewer(approvalMode)

/** Test/embedding seam for a classifier-backed server reviewer. */
export function setDesktopReviewerFactory(factory: DesktopReviewerFactory | undefined) {
  reviewerFactory = factory ?? ((mode) => new ApprovalModeDesktopReviewer(mode))
}

type DesktopApproval = {
  fingerprint: string
  stateId: string
}

export type DesktopRuntimeOptions = {
  driver: DesktopDriver
  reviewer?: DesktopReviewer
  approvalMode: string
  agentId: string
  conversationId: string
  turnId: string
  senderAgentId: string | null
  signal: AbortSignal
  approved?: DesktopApproval
  onPersisted: (message: ConversationMessage) => void
  suspend: (
    state: WaitingState,
    delivery: { bodyText: string; payload: SendMessagePayload },
  ) => Promise<ConversationMessage | undefined>
  timeoutMs?: number
}

type PersistedScreenshot = {
  fileId: string
  url: string
  mediaType: string
  width: number
  height: number
  stateId: string
  cursor?: { x: number; y: number }
}

type ComputerResult = {
  ok: boolean
  status: ComputerOutcome
  summary: string
  display?: { width: number; height: number; sessionId: string }
  screenshot?: PersistedScreenshot
  cursor?: { x: number; y: number }
  fingerprint?: string
  stateId?: string
}

type Lease = { owner: string }
const desktopLeases = new Map<string, Lease>()

/** Visible for deterministic concurrency tests and process diagnostics. */
export function activeDesktopLease(sessionId: string) {
  return desktopLeases.get(sessionId)?.owner
}

function tryAcquireDesktop(sessionId: string, owner: string) {
  if (desktopLeases.has(sessionId)) return false
  desktopLeases.set(sessionId, { owner })
  return true
}

function releaseDesktop(sessionId: string, owner: string) {
  if (desktopLeases.get(sessionId)?.owner === owner) desktopLeases.delete(sessionId)
}

function screenshotState(screenshot: DesktopScreenshot) {
  const bytes = Buffer.from(screenshot.dataBase64, 'base64')
  if (bytes.byteLength === 0 && screenshot.dataBase64.length > 0) {
    throw new DesktopDriverError('driver_failure', 'Desktop driver returned invalid screenshot data')
  }
  return {
    bytes,
    stateId:
      screenshot.stateId ?? createHash('sha256').update(bytes).digest('hex').slice(0, 32),
  }
}

function computerTimeoutMs() {
  const configured = Number(process.env.OPENBOT_COMPUTER_TIMEOUT_MS)
  return Number.isInteger(configured) && configured >= 1_000 && configured <= 300_000
    ? configured
    : 120_000
}

function actionFingerprint(input: Omit<DesktopReviewTarget, 'fingerprint'>) {
  return createHash('sha256')
    .update(
      JSON.stringify({
        version: 1,
        agentId: input.agentId,
        conversationId: input.conversationId,
        turnId: input.turnId,
        display: input.display,
        stateId: input.stateId,
        actions: input.actions,
      }),
    )
    .digest('hex')
}

function reviewedDescriptionError(actions: readonly DesktopAction[]) {
  const missing = actions.find((action) => {
    if (!SCREEN_CHANGING_ACTIONS.has(action.action)) return false
    return !('description' in action) || !action.description.trim()
  })
  return missing
    ? `${missing.action} requires a declared purpose`
    : undefined
}

function safeSummary(status: ComputerOutcome, summary: string) {
  if (status === 'success') return summary
  return `${status.replaceAll('_', ' ')}: ${summary}`
}

function failureFrom(
  error: unknown,
  timedOut: boolean,
  cancelled = false,
): { status: ComputerOutcome; message: string } {
  if (timedOut) return { status: 'timeout', message: 'Desktop operation timed out' }
  if (cancelled) return { status: 'cancelled', message: 'Desktop operation was cancelled' }
  if (error instanceof DesktopDriverError) return { status: error.code, message: error.message }
  if (error instanceof Error && error.name === 'AbortError') {
    return { status: 'cancelled', message: 'Desktop operation was cancelled' }
  }
  return {
    status: 'driver_failure',
    message: error instanceof Error ? error.message : 'Desktop driver failed',
  }
}

function combinedSignal(parent: AbortSignal, timeoutMs: number) {
  const controller = new AbortController()
  let timedOut = false
  const abortFromParent = () => controller.abort(parent.reason)
  if (parent.aborted) abortFromParent()
  else parent.addEventListener('abort', abortFromParent, { once: true })
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort(new Error('Desktop operation timed out'))
  }, timeoutMs)
  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    dispose: () => {
      clearTimeout(timer)
      parent.removeEventListener('abort', abortFromParent)
    },
  }
}

export class DesktopToolRuntime {
  private readonly reviewer: DesktopReviewer
  private readonly timeoutMs: number

  constructor(private readonly options: DesktopRuntimeOptions) {
    this.reviewer = options.reviewer ?? reviewerFactory(options.approvalMode)
    this.timeoutMs = options.timeoutMs ?? computerTimeoutMs()
  }

  private async priorResult(toolCallId: string): Promise<ComputerResult | undefined> {
    const rows = await listConversationMessages(this.options.conversationId)
    const row = rows.find(
      (candidate) =>
        candidate.turnId === this.options.turnId &&
        candidate.payloadJson.event === 'computer-use' &&
        candidate.payloadJson.toolCallId === toolCallId,
    )
    if (!row) return undefined
    const parsed = computerUsePayloadSchema.safeParse(row.payloadJson)
    if (!parsed.success || parsed.data.event !== 'computer-use') return undefined
    return {
      ok: parsed.data.status === 'success',
      status: parsed.data.outcome,
      summary: parsed.data.detail,
      ...(parsed.data.display && { display: parsed.data.display }),
      ...(parsed.data.screenshot && { screenshot: parsed.data.screenshot }),
      ...(parsed.data.cursor && { cursor: parsed.data.cursor }),
      ...(parsed.data.fingerprint && { fingerprint: parsed.data.fingerprint }),
      ...(parsed.data.stateId && { stateId: parsed.data.stateId }),
    }
  }

  private async hasUnsettledExecution(toolCallId: string) {
    const rows = await listConversationMessages(this.options.conversationId)
    return rows.some(
      (candidate) =>
        candidate.turnId === this.options.turnId &&
        candidate.payloadJson.event === 'computer-use-audit' &&
        candidate.payloadJson.toolCallId === toolCallId &&
        candidate.payloadJson.stage === 'execution_started',
    )
  }

  private async audit(
    toolCallId: string,
    fingerprint: string,
    stage: 'review_decision' | 'execution_started',
    actions: readonly DesktopAction[],
    summary: string,
    decision?: 'allowed' | 'blocked' | 'approval_required' | 'approved',
  ) {
    const payload = computerUsePayloadSchema.parse({
      version: 1,
      event: 'computer-use-audit',
      toolCallId,
      fingerprint,
      stage,
      ...(decision && { decision }),
      actions: actions.map((action) => action.action),
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
    console.info('[computer audit]', {
      agentId: this.options.agentId,
      conversationId: this.options.conversationId,
      turnId: this.options.turnId,
      toolCallId,
      fingerprint,
      stage,
      decision,
      actions: actions.map((action) => action.action),
    })
  }

  private async progress(toolCallId: string, fingerprint: string, summary: string) {
    const message = await appendConversationMessage({
      conversationId: this.options.conversationId,
      turnId: this.options.turnId,
      senderAgentId: this.options.senderAgentId,
      kind: 'status',
      direction: 'outbound',
      bodyText: `Computer: ${summary}`,
      payload: computerUsePayloadSchema.parse({
        version: 1,
        event: 'computer-use-progress',
        toolCallId,
        name: 'Computer',
        preview: summary,
        status: 'pending',
        fingerprint,
      }),
    })
    this.options.onPersisted(message)
  }

  private async persist(
    toolCallId: string,
    toolName: 'Screenshot' | 'Computer',
    result: ComputerResult,
    screenshot?: DesktopScreenshot,
  ) {
    let persistedScreenshot: PersistedScreenshot | undefined
    let attachment:
      | { fileId: string; name: string; mediaType: string; byteSize: number }
      | undefined
    if (screenshot) {
      const { bytes, stateId } = screenshotState(screenshot)
      if (bytes.byteLength > 25 * 1024 * 1024) {
        throw new DesktopDriverError('driver_failure', 'Screenshot exceeds the 25 MB limit')
      }
      const extension =
        screenshot.mediaType === 'image/jpeg'
          ? 'jpg'
          : screenshot.mediaType === 'image/webp'
            ? 'webp'
            : 'png'
      const file = await createManagedFile({
        bytes,
        originalName: `remote-desktop-${Date.now()}.${extension}`,
        mediaType: screenshot.mediaType,
        subdirectory: `computer/${this.options.conversationId}`,
      })
      persistedScreenshot = {
        fileId: file.id,
        url: `/api/files/${file.id}`,
        mediaType: screenshot.mediaType,
        width: screenshot.width,
        height: screenshot.height,
        stateId,
        ...(screenshot.cursor && { cursor: screenshot.cursor }),
      }
      attachment = {
        fileId: file.id,
        name: file.originalName,
        mediaType: screenshot.mediaType,
        byteSize: file.byteSize,
      }
    }

    const finalResult = persistedScreenshot
      ? { ...result, screenshot: persistedScreenshot }
      : result
    const payload = computerUsePayloadSchema.parse({
      version: 1,
      event: 'computer-use',
      toolCallId,
      name: toolName,
      preview: finalResult.summary,
      status: finalResult.ok ? 'success' : 'failed',
      outcome: finalResult.status,
      detail: finalResult.summary,
      ...(finalResult.display && { display: finalResult.display }),
      ...(finalResult.cursor && { cursor: finalResult.cursor }),
      ...(finalResult.fingerprint && { fingerprint: finalResult.fingerprint }),
      ...(finalResult.stateId && { stateId: finalResult.stateId }),
      ...(persistedScreenshot && { screenshot: persistedScreenshot }),
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
          items: [
            {
              fileId: attachment.fileId,
              position: 0,
              metadata: {
                name: attachment.name,
                mediaType: attachment.mediaType,
                byteSize: attachment.byteSize,
              },
            },
          ],
        },
      }),
    })
    this.options.onPersisted(message)
    console.info('[computer audit]', {
      agentId: this.options.agentId,
      conversationId: this.options.conversationId,
      turnId: this.options.turnId,
      toolCallId,
      outcome: finalResult.status,
      fingerprint: finalResult.fingerprint,
      screenshotFileId: persistedScreenshot?.fileId,
    })
    return finalResult
  }

  async persistInvalid(
    toolCallId: string,
    toolName: 'Screenshot' | 'Computer',
    error: z.ZodError,
  ) {
    return this.persist(toolCallId, toolName, {
      ok: false,
      status: 'invalid_input',
      summary: z.prettifyError(error),
    })
  }

  async screenshot(toolCallId: string): Promise<ComputerResult> {
    const prior = await this.priorResult(toolCallId)
    if (prior) return prior
    const operation = combinedSignal(this.options.signal, this.timeoutMs)
    try {
      const display = await this.options.driver.getDisplay(operation.signal)
      const owner = `${this.options.turnId}:${toolCallId}:screenshot`
      if (!tryAcquireDesktop(display.sessionId, owner)) {
        return await this.persist(toolCallId, 'Screenshot', {
          ok: false,
          status: 'desktop_busy',
          summary: 'The Remote Desktop is changing under another Computer sequence',
          display,
        })
      }
      let screenshot: DesktopScreenshot
      try {
        screenshot = await this.options.driver.captureScreenshot(operation.signal)
      } finally {
        releaseDesktop(display.sessionId, owner)
      }
      if (screenshot.width !== display.width || screenshot.height !== display.height) {
        return await this.persist(toolCallId, 'Screenshot', {
          ok: false,
          status: 'driver_failure',
          summary: 'Screenshot dimensions do not match the configured desktop',
        })
      }
      const stateId = screenshotState(screenshot).stateId
      return await this.persist(
        toolCallId,
        'Screenshot',
        {
          ok: true,
          status: 'success',
          summary: `Captured the ${display.width}×${display.height} Remote Desktop`,
          display,
          stateId,
          ...(screenshot.cursor && { cursor: screenshot.cursor }),
        },
        screenshot,
      )
    } catch (error) {
      const failure = failureFrom(error, operation.timedOut(), this.options.signal.aborted)
      return this.persist(toolCallId, 'Screenshot', {
        ok: false,
        status: failure.status,
        summary: failure.message,
      })
    } finally {
      operation.dispose()
    }
  }

  async computer(toolCallId: string, args: ComputerArgs): Promise<ComputerResult> {
    const prior = await this.priorResult(toolCallId)
    if (prior) return prior
    const operation = combinedSignal(this.options.signal, this.timeoutMs)
    let display: DesktopDisplay | undefined
    let owner: string | undefined
    let fingerprint: string | undefined
    try {
      display = await this.options.driver.getDisplay(operation.signal)
      const normalized = normalizeComputerArgs(args)
      const boundsError = validateDisplayBounds(normalized.actions, display)
      if (boundsError) {
        return await this.persist(toolCallId, 'Computer', {
          ok: false,
          status: 'invalid_input',
          summary: boundsError,
          display,
        })
      }
      const descriptionError = reviewedDescriptionError(normalized.actions)
      if (descriptionError) {
        return await this.persist(toolCallId, 'Computer', {
          ok: false,
          status: 'invalid_input',
          summary: descriptionError,
          display,
        })
      }

      const observationOwner = `${this.options.turnId}:${toolCallId}:review`
      if (!tryAcquireDesktop(display.sessionId, observationOwner)) {
        return await this.persist(toolCallId, 'Computer', {
          ok: false,
          status: 'desktop_busy',
          summary: 'Another agent is currently controlling the Remote Desktop',
          display,
        })
      }
      let before: DesktopScreenshot
      try {
        before = await this.options.driver.captureScreenshot(operation.signal)
      } finally {
        releaseDesktop(display.sessionId, observationOwner)
      }
      if (before.width !== display.width || before.height !== display.height) {
        return await this.persist(toolCallId, 'Computer', {
          ok: false,
          status: 'driver_failure',
          summary: 'Current screenshot dimensions do not match the configured desktop',
          display,
        })
      }
      const stateId = screenshotState(before).stateId
      if (normalized.expectedStateId && normalized.expectedStateId !== stateId) {
        return await this.persist(toolCallId, 'Computer', {
          ok: false,
          status: 'stale_desktop',
          summary: 'The Remote Desktop changed after the screenshot used to plan this action',
          display,
        })
      }
      const reviewBase = {
        agentId: this.options.agentId,
        conversationId: this.options.conversationId,
        turnId: this.options.turnId,
        display,
        stateId,
        actions: normalized.actions,
      }
      fingerprint = actionFingerprint(reviewBase)
      const review = await this.reviewer.review({ ...reviewBase, fingerprint })
      const hasApproval =
        this.options.approved?.fingerprint === fingerprint &&
        this.options.approved.stateId === stateId
      if (this.options.approved && !hasApproval) {
        await this.audit(
          toolCallId,
          fingerprint,
          'review_decision',
          normalized.actions,
          'Rejected stale one-shot approval',
          'blocked',
        )
        return await this.persist(toolCallId, 'Computer', {
          ok: false,
          status: 'stale_desktop',
          summary:
            'The approved action or Remote Desktop state changed; capture a fresh screenshot and review again',
          display,
          fingerprint,
        })
      }
      if (review.decision === 'block') {
        await this.audit(
          toolCallId,
          fingerprint,
          'review_decision',
          normalized.actions,
          review.reason,
          'blocked',
        )
        return await this.persist(toolCallId, 'Computer', {
          ok: false,
          status: 'review_blocked',
          summary: review.reason,
          display,
          fingerprint,
        })
      }
      if (review.decision === 'approval' && !hasApproval) {
        const summary = actionSummary(normalized.actions)
        const state: WaitingState = {
          version: 1,
          interactionKind: 'approval',
          prompt: `Allow Computer to ${summary} on the Remote Desktop?`,
          helpText: review.reason,
          options: [
            { id: 'approve', label: 'Allow once', style: 'primary' },
            { id: 'deny', label: 'Deny', style: 'danger' },
          ],
          allowCustom: false,
          dismissOnMoveOn: false,
          originatingToolCall: { id: toolCallId, name: 'Computer' },
          resumeData: {
            version: 1,
            kind: 'computer-approval',
            fingerprint,
            stateId,
          },
          response: null,
        }
        await this.audit(
          toolCallId,
          fingerprint,
          'review_decision',
          normalized.actions,
          review.reason,
          'approval_required',
        )
        await this.options.suspend(state, {
          bodyText: state.prompt,
          payload: {
            version: 1,
            deliveryKind: 'send-message',
            type: 'widget',
            toolCallId,
            widget: {
              prompt: state.prompt,
              helpText: state.helpText,
              interactionKind: 'approval',
              options: state.options,
              allowCustom: false,
              dismissOnMoveOn: false,
            },
          },
        })
        return {
          ok: false,
          status: 'approval_required',
          summary: review.reason,
          display,
          fingerprint,
        }
      }

      await this.audit(
        toolCallId,
        fingerprint,
        'review_decision',
        normalized.actions,
        review.reason ?? 'Allowed by Computer Use policy',
        hasApproval ? 'approved' : 'allowed',
      )

      const actions = [...normalized.actions]
      const needsFinalScreenshot =
        actions.some((action) => SCREEN_CHANGING_ACTIONS.has(action.action)) &&
        actions.at(-1)?.action !== 'screenshot'
      if (needsFinalScreenshot) actions.push({ action: 'screenshot' })

      owner = `${this.options.turnId}:${toolCallId}`
      if (!tryAcquireDesktop(display.sessionId, owner)) {
        return await this.persist(toolCallId, 'Computer', {
          ok: false,
          status: 'desktop_busy',
          summary: 'Another agent is currently controlling the Remote Desktop',
          display,
          fingerprint,
        })
      }

      if (await this.hasUnsettledExecution(toolCallId)) {
        return await this.persist(toolCallId, 'Computer', {
          ok: false,
          status: 'driver_failure',
          summary:
            'A previous execution of this exact tool call has an unknown outcome; it was not repeated',
          display,
          fingerprint,
        })
      }

      // The lease closes the race between review and execution. Re-capture
      // only after owning it; an intervening desktop change invalidates the
      // reviewed coordinates and any one-shot approval.
      const immediatelyBefore = await this.options.driver.captureScreenshot(operation.signal)
      const currentDisplay = await this.options.driver.getDisplay(operation.signal)
      const currentBoundsError = validateDisplayBounds(normalized.actions, currentDisplay)
      if (
        currentDisplay.sessionId !== display.sessionId ||
        currentDisplay.width !== display.width ||
        currentDisplay.height !== display.height ||
        immediatelyBefore.width !== currentDisplay.width ||
        immediatelyBefore.height !== currentDisplay.height ||
        currentBoundsError
      ) {
        return await this.persist(toolCallId, 'Computer', {
          ok: false,
          status: 'stale_desktop',
          summary:
            currentBoundsError ??
            'The Remote Desktop display changed between review and execution',
          display: currentDisplay,
          fingerprint,
        })
      }
      if (screenshotState(immediatelyBefore).stateId !== stateId) {
        return await this.persist(toolCallId, 'Computer', {
          ok: false,
          status: 'stale_desktop',
          summary: 'The Remote Desktop changed between review and execution',
          display,
          fingerprint,
        })
      }


      await this.audit(
        toolCallId,
        fingerprint,
        'execution_started',
        normalized.actions,
        `Executing ${actionSummary(normalized.actions)}`,
      )
      await this.progress(toolCallId, fingerprint, actionSummary(normalized.actions))

      const executed = await this.options.driver.execute(actions, operation.signal)
      let finalScreenshot = executed.screenshot
      if (
        !finalScreenshot &&
        (needsFinalScreenshot || actions.some((action) => action.action === 'screenshot'))
      ) {
        finalScreenshot = await this.options.driver.captureScreenshot(operation.signal)
      }
      const summary = `Completed: ${actionSummary(normalized.actions)}`
      return await this.persist(
        toolCallId,
        'Computer',
        {
          ok: true,
          status: 'success',
          summary,
          display,
          fingerprint,
          ...(executed.cursor && { cursor: executed.cursor }),
        },
        finalScreenshot,
      )
    } catch (error) {
      const failure = failureFrom(error, operation.timedOut(), this.options.signal.aborted)
      return this.persist(toolCallId, 'Computer', {
        ok: false,
        status: failure.status,
        summary: failure.message,
        ...(display && { display }),
        ...(fingerprint && { fingerprint }),
      })
    } finally {
      if (display && owner) releaseDesktop(display.sessionId, owner)
      operation.dispose()
    }
  }
}

export function computerApprovalFromWaitingState(state: WaitingState | undefined) {
  if (
    state?.originatingToolCall.name !== 'Computer' ||
    state.interactionKind !== 'approval' ||
    state.response?.optionId !== 'approve' ||
    !state.resumeData ||
    typeof state.resumeData !== 'object' ||
    Array.isArray(state.resumeData)
  ) {
    return undefined
  }
  const data = state.resumeData as Record<string, unknown>
  return data.kind === 'computer-approval' &&
    typeof data.fingerprint === 'string' &&
    typeof data.stateId === 'string'
    ? { fingerprint: data.fingerprint, stateId: data.stateId }
    : undefined
}
