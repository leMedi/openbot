import { randomUUID } from 'node:crypto'
import {
  findPendingDesktopHandoff,
  type Agent,
  type ModelToolCall,
  type ToolDefinition,
  type WaitingState,
} from '@openbot/db'
import * as z from 'zod'
import {
  releaseAutomationLease,
  tryAcquireAutomationLease,
  x11AutomationLeaseKey,
} from '../automation/lease'
import type { ToolTurnContext } from './send-message'

export const REQUEST_DESKTOP_HELP_TOOL_NAME = 'RequestDesktopHelp'

export const requestDesktopHelpArgsSchema = z.object({
  instruction: z.string().trim().min(1).max(500),
  reason: z.enum(['auth', 'captcha', 'payment', 'other']),
  domain: z.string().trim().min(1).max(253).optional(),
  identity_provider_domain: z.string().trim().min(1).max(253).optional(),
}).strict()

export const requestDesktopHelpToolDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: REQUEST_DESKTOP_HELP_TOOL_NAME,
    description:
      'Pause this turn and hand the Remote Desktop to the user for one human-only browser step. ' +
      'Use one short instruction for sign-in, SSO, passkey, 2FA, CAPTCHA, or payment; never ask ' +
      'for credentials in chat. The desktop opens for the user and this turn resumes after they ' +
      'hand it back or skip the step.',
    parameters: {
      type: 'object',
      properties: {
        instruction: {
          type: 'string',
          description: 'One short instruction addressed to the user.',
        },
        reason: {
          type: 'string',
          enum: ['auth', 'captcha', 'payment', 'other'],
          description: 'Why direct user control is required.',
        },
        domain: {
          type: 'string',
          description: 'Destination app or site domain, when known.',
        },
        identity_provider_domain: {
          type: 'string',
          description: 'SSO identity-provider domain, when different from the destination.',
        },
      },
      required: ['instruction', 'reason'],
      additionalProperties: false,
    },
  },
}

function handoffIdFrom(turn: Awaited<ReturnType<typeof findPendingDesktopHandoff>>) {
  if (!turn) return undefined
  const state = turn.waitingStateJson as WaitingState
  const resume = state.resumeData
  return resume && typeof resume === 'object' && !Array.isArray(resume) &&
    typeof resume.handoffId === 'string'
    ? resume.handoffId
    : turn.id
}

export async function executeRequestDesktopHelp(
  agent: Agent,
  args: z.infer<typeof requestDesktopHelpArgsSchema>,
  call: ModelToolCall,
  context?: ToolTurnContext,
) {
  if (!context?.desktop) {
    return { error: 'RequestDesktopHelp is unavailable without a Remote Desktop' }
  }
  const pending = await findPendingDesktopHandoff(agent.id)
  if (pending) {
    return { status: 'already_pending', handoff_id: handoffIdFrom(pending)! }
  }

  const handoffId = `handoff_${randomUUID()}`
  const state: WaitingState = {
    version: 1,
    interactionKind: 'handoff',
    prompt: args.instruction,
    helpText: 'Complete this step directly on the Remote Desktop, then hand control back.',
    options: [
      { id: 'hand_back', label: 'Hand back', style: 'primary' },
      { id: 'skip', label: 'Skip', style: 'danger' },
    ],
    allowCustom: false,
    dismissOnMoveOn: false,
    originatingToolCall: { id: call.id, name: REQUEST_DESKTOP_HELP_TOOL_NAME },
    resumeData: {
      version: 1,
      kind: 'desktop-handoff',
      handoffId,
      agentId: agent.id,
      reason: args.reason,
      ...(args.domain && { domain: args.domain }),
      ...(args.identity_provider_domain && {
        identityProviderDomain: args.identity_provider_domain,
      }),
    },
    response: null,
  }
  if (agent.xDisplayNumber == null) {
    return { status: 'unavailable', handoff_id: handoffId }
  }
  const leaseKey = x11AutomationLeaseKey(agent.xDisplayNumber)
  const owner = `${context.turnId}:${call.id}:desktop-handoff`
  if (!tryAcquireAutomationLease(leaseKey, owner)) {
    return { status: 'desktop_busy', handoff_id: handoffId }
  }
  let delivered
  try {
    delivered = await context.suspend(state, {
      bodyText: args.instruction,
      payload: {
        version: 1,
        deliveryKind: 'send-message',
        type: 'widget',
        toolCallId: call.id,
        widget: {
          prompt: args.instruction,
          helpText: state.helpText,
          interactionKind: 'handoff',
          options: state.options,
          allowCustom: false,
          dismissOnMoveOn: false,
        },
      },
    })
  } finally {
    releaseAutomationLease(leaseKey, owner)
  }
  if (!delivered) {
    const concurrent = await findPendingDesktopHandoff(agent.id)
    return concurrent
      ? { status: 'already_pending', handoff_id: handoffIdFrom(concurrent)! }
      : { status: 'unavailable', handoff_id: handoffId }
  }
  return { status: 'started', handoff_id: handoffId }
}
