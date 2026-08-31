import {
  type Agent,
  claimQueuedTurn,
  type ConversationMessage,
  finalizeTurnTerminal,
  finalizeTurnSuccess,
  findChildTurns,
  findNextQueuedTurnForAgent,
  findNextQueuedTurnForGroup,
  getAgent,
  getConversation,
  getGroup,
  getTurn,
  type Group,
  listConversationMessages,
  listQueuedTurns,
  markTurnWaiting,
  type ModelMessage,
  modelMessageSchema,
  queueGroupChildTurn,
  recordTurnExecution,
  type WaitingState,
  waitingStateSchema,
} from '@openbot/db'
import * as z from 'zod'
import { getAiConfig, streamChatCompletion, type ToolChoice, type ToolDefinition } from './ai'
import {
  agentToolDefinitions,
  backgroundToolDefinitions,
  executeAgentToolCall,
  sendMessageOnlyToolDefinitions,
  type ToolTurnContext,
} from './agent-tools'
import {
  assembleGroupModelMessages,
  assemblePrivateModelMessages,
  renderPrivateSystemMessage,
} from './prompt-assembly'
import {
  CLOSING_NUDGE_ROUNDS,
  CLOSING_SEND_NUDGE,
  FINAL_REPLY_NUDGE,
  initialDeliveryState,
  isSystemReminder,
  MAX_FINAL_REPLY_NUDGES,
  MAX_SEND_ONLY_ROUNDS,
  planRoundReminder,
  recordDelivery,
  REPLY_REMINDER,
  restartedTurnReminder,
  SEND_MESSAGE_TOOL_NAME,
  TOOL_BUDGET_EXHAUSTED_REMINDER,
  wrapSystemReminder,
} from './send-message-reminders'
import { discoverMcpToolsForTurn, type McpToolRegistry } from './mcp-tools'

// A turn may interleave tool calls and completions; after this many rounds
// the toolset degrades to SendMessage only, so delivery stays possible.
const MAX_TOOL_ROUNDS = 8

// Mid-turn history stored on a waiting turn so the resumed run replays a
// coherent tool transcript (the system prompt is re-rendered on resume).
const resumeMessagesSchema = z.object({ modelMessages: z.array(modelMessageSchema) })

// In-memory execution state. Durable truth lives in the turns table; these
// maps only fan visible output out to connected clients and serialize
// execution per target. Plain assistant text is model-private: the only
// visible output is delivered SendMessage rows.
export type TurnStreamEvent =
  | { type: 'message'; message: ConversationMessage }
  | { type: 'done'; turnId: string }
  | { type: 'waiting'; turnId: string; state: WaitingState }
  | { type: 'error'; message: string; status?: 'failed' | 'cancelled' }

type ActiveTurn = {
  delivered: ConversationMessage[]
  controller: AbortController
  subscribers: Set<(event: TurnStreamEvent) => void>
}

const activeTurns = new Map<string, ActiveTurn>()
const agentDrains = new Map<string, Promise<void>>()
const groupDrains = new Map<string, Promise<void>>()

/** The group's member agents, resolved and kept in membership order. */
async function memberAgentsOf(group: Group) {
  const resolved = await Promise.all(
    group.membersJson.members
      .filter((m) => m.type === 'agent')
      .map((m) => getAgent(m.agentId)),
  )
  return resolved.filter((agent): agent is Agent => !!agent)
}

/**
 * MVP member selection: the first member mentioned in the posted text (by
 * `@name` or plain name on word boundaries, earliest occurrence wins),
 * falling back to the first member in membership order. Selection from
 * recent room context and multi-member rounds are future work.
 */
export function selectGroupMember(members: Agent[], text: string) {
  let best: { agent: Agent; index: number } | undefined
  for (const agent of members) {
    const name = agent.name.trim()
    if (!name) continue
    // Word-bounded so "Ann" is not "mentioned" by the word "planning".
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const match = new RegExp(
      `(?:^|[^\\p{L}\\p{N}_])@?${escaped}(?:$|[^\\p{L}\\p{N}_])`,
      'iu',
    ).exec(text)
    if (match && (!best || match.index < best.index)) {
      best = { agent, index: match.index }
    }
  }
  return best?.agent ?? members[0]
}

async function executeTurn(turnId: string) {
  const claimed = await claimQueuedTurn(turnId)
  if (!claimed) return

  const active: ActiveTurn = {
    delivered: [],
    controller: new AbortController(),
    subscribers: new Set(),
  }
  activeTurns.set(turnId, active)
  const emit = (event: TurnStreamEvent) => {
    for (const subscriber of active.subscribers) subscriber(event)
  }
  // Terminal events go out after the active entry is dropped, so a late
  // watcher can never subscribe to a turn that will emit nothing further.
  const emitTerminal = (event: TurnStreamEvent) => {
    const subscribers = [...active.subscribers]
    activeTurns.delete(turnId)
    for (const subscriber of subscribers) subscriber(event)
  }
  let mcpRegistry: McpToolRegistry | undefined

  try {
    const conversation = await getConversation(claimed.conversationId)
    if (!conversation) {
      throw new Error(`Conversation ${claimed.conversationId} not found`)
    }
    // The executing identity is the turn's target (group child turns run a
    // member agent inside a group-owned conversation).
    const agentId = claimed.targetAgentId ?? conversation.ownerAgentId
    if (!agentId) {
      throw new Error(`Turn ${turnId} has no executing agent`)
    }
    const agent = await getAgent(agentId)
    if (!agent) throw new Error(`Agent ${agentId} not found`)
    const group = conversation.ownerGroupId
      ? await getGroup(conversation.ownerGroupId)
      : undefined
    if (conversation.ownerGroupId && !group) {
      throw new Error(`Group ${conversation.ownerGroupId} not found`)
    }

    const config = getAiConfig()
    const waitingState = claimed.waitingStateJson
      ? waitingStateSchema.parse(claimed.waitingStateJson)
      : undefined
    // Visible turns carry the delivery contract (SendMessage + reminders);
    // hidden background work has no user to talk to and is exempt.
    const remindersApply = claimed.lane !== 'background'
    const builtInToolDefinitions = remindersApply
      ? agentToolDefinitions
      : backgroundToolDefinitions
    const currentMcpRegistry = await discoverMcpToolsForTurn(
      agent.id,
      active.controller.signal,
    )
    mcpRegistry = currentMcpRegistry
    const toolDefinitions = [...builtInToolDefinitions, ...currentMcpRegistry.definitions]
    // Historical snapshot of what this execution actually used.
    await recordTurnExecution(turnId, {
      modelProvider: 'openai-compatible',
      modelId: config.model,
      effectiveTools: {
        version: 1,
        tools: toolDefinitions.map((tool) => tool.function.name),
      },
      effectivePermissions: { version: 1, approvalMode: agent.approvalMode },
      runtimeContext: {
        version: 1,
        baseUrl: config.baseUrl,
        lane: claimed.lane,
        mode: claimed.mode,
        ...(waitingState && {
          resumeData: waitingState.resumeData,
          originatingToolCall: waitingState.originatingToolCall,
          response: waitingState.response,
        }),
      },
    })

    // Rows an earlier claim of this turn already delivered (a crashed attempt
    // or the pre-suspension half of a widget turn): they seed the delivery
    // accounting and let the executor dedupe identical resends.
    const priorDeliveries =
      claimed.attemptCount > 1
        ? (await listConversationMessages(conversation.id)).filter(
            (row) =>
              row.turnId === turnId &&
              row.payloadJson.deliveryKind === 'send-message',
          )
        : []
    const state = initialDeliveryState(
      priorDeliveries.map((row) => String(row.payloadJson.type ?? 'text')),
    )

    // Model-facing input. A widget-resumed private turn replays its stored
    // mid-turn history; otherwise group rooms rebuild the shared transcript
    // from this member's perspective and private rooms replay the checkpoint
    // history. The system prompt is re-rendered from live state every run.
    let modelMessages: ModelMessage[] | undefined
    if (!group && waitingState?.response) {
      const stored = resumeMessagesSchema.safeParse(waitingState.resumeData)
      if (stored.success) {
        modelMessages = [
          await renderPrivateSystemMessage(agent),
          ...stored.data.modelMessages,
          { role: 'user', content: waitingState.response.text },
        ]
      }
    }
    if (!modelMessages) {
      modelMessages = group
        ? await assembleGroupModelMessages({
            agent,
            group,
            members: await memberAgentsOf(group),
            conversationId: conversation.id,
          })
        : await assemblePrivateModelMessages({
            agent,
            conversationId: conversation.id,
            turnId,
          })
      if (remindersApply) modelMessages.push(wrapSystemReminder(REPLY_REMINDER))
    }
    if (remindersApply && priorDeliveries.length > 0 && !waitingState?.response) {
      modelMessages.push(
        wrapSystemReminder(
          restartedTurnReminder(priorDeliveries.map((row) => row.bodyText ?? '')),
        ),
      )
    }
    const messages = modelMessages

    console.info('[agent prompt]', {
      agent: { id: agent.id, name: agent.name },
      model: config.model,
      prompt: messages,
    })

    const toolContext: ToolTurnContext = {
      turnId,
      conversationId: conversation.id,
      // In a shared group room the transcript must carry the member's
      // identity; in a private room the owning agent is implied.
      senderAgentId: group ? agent.id : null,
      priorDeliveries,
      onDelivered: (message) => {
        active.delivered.push(message)
        emit({ type: 'message', message })
        const type = message.payloadJson.type
        recordDelivery(state, type === 'widget' || type === 'attachment' ? type : 'text')
      },
    }

    // Private prose never streams to the user; only delivered rows do.
    const onDelta = () => {}

    /** One model round: append prose or execute the requested tool calls. */
    const executeRound = async (tools?: ToolDefinition[], toolChoice?: ToolChoice) => {
      const completion = await streamChatCompletion(
        config,
        messages,
        onDelta,
        active.controller.signal,
        tools,
        toolChoice,
      )
      if (completion.toolCalls.length === 0) {
        if (completion.text) messages.push({ role: 'assistant', content: completion.text })
        return 0
      }
      messages.push({
        role: 'assistant',
        content: completion.text,
        tool_calls: completion.toolCalls,
      })
      for (const toolCall of completion.toolCalls) {
        console.info('[agent tool]', {
          agent: { id: agent.id, name: agent.name },
          tool: toolCall.function.name,
          arguments: toolCall.function.arguments,
        })
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: currentMcpRegistry.has(toolCall.function.name)
            ? await currentMcpRegistry.execute(toolCall, active.controller.signal)
            : await executeAgentToolCall(agent, toolCall, toolContext),
        })
        state.totalToolCalls += 1
        if (toolCall.function.name !== SEND_MESSAGE_TOOL_NAME) {
          state.silentToolCallsSinceLastSend += 1
        }
      }
      return completion.toolCalls.length
    }

    // Completion/tool loop: full toolset within the round budget, then
    // SendMessage-only degraded rounds so delivery stays possible (hidden
    // turns keep one legacy tool-less final round instead). Reminders are
    // injected per round when the turn is going silent.
    const runToolLoop = async (maxRounds: number) => {
      for (let round = 0; ; round += 1) {
        const sendOnly = round >= maxRounds
        if (round >= maxRounds + (remindersApply ? MAX_SEND_ONLY_ROUNDS : 1)) return
        if (remindersApply) {
          if (sendOnly && round === maxRounds) {
            messages.push(wrapSystemReminder(TOOL_BUDGET_EXHAUSTED_REMINDER))
          } else if (!sendOnly && round > 0) {
            const reminder = planRoundReminder(state)
            if (reminder) messages.push(wrapSystemReminder(reminder))
          }
        }
        const tools = sendOnly
          ? remindersApply
            ? sendMessageOnlyToolDefinitions
            : undefined
          : toolDefinitions
        const toolCallCount = await executeRound(tools)
        if (toolCallCount === 0 || toolContext.pendingWaiting) return
      }
    }

    // A widget send suspends the turn once its round settles: the waiting
    // state stores the mid-turn history and the stream hands off to the
    // waiting UI. respondToWaitingTurn re-queues the turn with the response.
    const suspendIfWaiting = async () => {
      const pending = toolContext.pendingWaiting
      if (!pending) return false
      const turn = await markTurnWaiting(turnId, {
        version: 1,
        prompt: pending.prompt,
        options: pending.options,
        originatingToolCall: { id: pending.toolCallId, name: SEND_MESSAGE_TOOL_NAME },
        resumeData: JSON.parse(
          JSON.stringify({
            modelMessages: messages.filter((message) => message.role !== 'system'),
          }),
        ),
        response: null,
      })
      if (!turn) throw new Error(`Turn ${turnId} is no longer running`)
      emitTerminal({
        type: 'waiting',
        turnId,
        state: waitingStateSchema.parse(turn.waitingStateJson),
      })
      return true
    }

    await runToolLoop(MAX_TOOL_ROUNDS)
    if (await suspendIfWaiting()) return

    if (remindersApply) {
      // Delivery owed: a visible turn that sent nothing is re-run with only
      // SendMessage on offer, forcing the call on the last attempt.
      for (
        let nudge = 0;
        state.sentMessageCount === 0 && nudge < MAX_FINAL_REPLY_NUDGES;
        nudge += 1
      ) {
        messages.push(wrapSystemReminder(FINAL_REPLY_NUDGE))
        await executeRound(
          sendMessageOnlyToolDefinitions,
          nudge === MAX_FINAL_REPLY_NUDGES - 1
            ? { type: 'function', function: { name: SEND_MESSAGE_TOOL_NAME } }
            : undefined,
        )
        if (await suspendIfWaiting()) return
      }
      // A turn that went quiet after its last delivery may still owe the
      // result those tool calls produced; re-enter the loop once.
      if (state.sentMessageCount > 0 && state.silentToolCallsSinceLastSend > 0) {
        messages.push(wrapSystemReminder(CLOSING_SEND_NUDGE))
        await runToolLoop(CLOSING_NUDGE_ROUNDS)
        if (await suspendIfWaiting()) return
      }
    }

    // One transaction: next checkpoint (pointer advance) and the succeeded
    // status. Delivered rows were appended in-flight as idempotent side
    // effects; injected reminders never persist.
    await finalizeTurnSuccess({
      turnId,
      conversationId: conversation.id,
      checkpointState: {
        version: 1,
        modelMessages: messages.filter((message) => !isSystemReminder(message)),
      },
    })
    emitTerminal({ type: 'done', turnId })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Turn execution failed'
    const settled = await finalizeTurnTerminal({
      turnId,
      status: 'failed',
      message,
    }).catch(() => undefined)
    const visibleMessage =
      settled?.turn.errorJson && typeof settled.turn.errorJson.message === 'string'
        ? settled.turn.errorJson.message
        : message
    emitTerminal({
      type: 'error',
      message: visibleMessage,
      status: settled?.turn.status === 'cancelled' ? 'cancelled' : 'failed',
    })
  } finally {
    await mcpRegistry?.close().catch(() => {})
    activeTurns.delete(turnId)
  }
}

/**
 * Executes one group-targeted orchestration turn: select one member from the
 * posted text and queue the agent-targeted child turn that will answer in
 * the same shared conversation. The orchestration turn itself produces no
 * visible output; watchers hand off to the child turn.
 */
async function executeGroupTurn(turnId: string) {
  const claimed = await claimQueuedTurn(turnId)
  if (!claimed) return

  try {
    if (!claimed.targetGroupId) {
      throw new Error(`Turn ${turnId} is not group-targeted`)
    }
    const group = await getGroup(claimed.targetGroupId)
    if (!group) throw new Error(`Group ${claimed.targetGroupId} not found`)
    const members = await memberAgentsOf(group)
    if (members.length === 0) {
      throw new Error(`Group ${group.name} has no members to answer`)
    }

    const triggeringText = (await listConversationMessages(claimed.conversationId))
      .filter((m) => m.turnId === turnId && m.kind === 'message' && m.role === 'user')
      .map((m) => m.bodyText ?? '')
      .join('\n')
    const selected = selectGroupMember(members, triggeringText)

    const { childTurn } = await queueGroupChildTurn({
      groupTurnId: turnId,
      targetAgentId: selected.id,
      orchestrationRound: 0,
      positionInRound: 0,
    })
    ensureDrainForTurn(childTurn)
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Group turn orchestration failed'
    await finalizeTurnTerminal({
      turnId,
      status: 'failed',
      message,
    }).catch(() => {})
  }
}

/** Settles a durable turn first, then interrupts an in-flight model request. */
export async function cancelTurnExecution(turnId: string) {
  let result = await finalizeTurnTerminal({
    turnId,
    status: 'cancelled',
    message: 'Cancelled by user',
  })
  if (!result.changed && result.turn.status === 'succeeded') {
    const child = (await findChildTurns(turnId)).at(-1)
    if (child && ['queued', 'running', 'waiting'].includes(child.status)) {
      result = await finalizeTurnTerminal({
        turnId: child.id,
        status: 'cancelled',
        message: 'Cancelled by user',
      })
    }
  }
  if (result.changed) activeTurns.get(turnId)?.controller.abort()
  if (result.changed) activeTurns.get(result.turn.id)?.controller.abort()
  if (result.changed) ensureDrainAfterCurrent(result.turn)
  return result.turn
}

function ensureDrainAfterCurrent(turn: {
  targetAgentId: string | null
  targetGroupId: string | null
}) {
  const current = turn.targetAgentId
    ? agentDrains.get(turn.targetAgentId)
    : turn.targetGroupId
      ? groupDrains.get(turn.targetGroupId)
      : undefined
  if (!current) {
    ensureDrainForTurn(turn)
    return
  }
  void current.then(
    () => ensureDrainForTurn(turn),
    () => ensureDrainForTurn(turn),
  )
}

/**
 * Runs one group's queued orchestration turns to exhaustion, one at a time.
 * At most one drain loop exists per group — "one active turn per target" for
 * group-targeted turns. Member child turns run on their agents' own drains.
 */
export function ensureGroupDrain(groupId: string): Promise<void> {
  const existing = groupDrains.get(groupId)
  if (existing) return existing
  const drain = (async () => {
    while (true) {
      const next = await findNextQueuedTurnForGroup(groupId)
      if (!next) return
      await executeGroupTurn(next.id)
    }
  })().finally(() => {
    groupDrains.delete(groupId)
  })
  groupDrains.set(groupId, drain)
  return drain
}

/** Kicks the drain loop for whichever target (agent or group) a turn has. */
export function ensureDrainForTurn(turn: {
  targetAgentId: string | null
  targetGroupId: string | null
}) {
  if (turn.targetAgentId) void ensureAgentDrain(turn.targetAgentId)
  else if (turn.targetGroupId) void ensureGroupDrain(turn.targetGroupId)
}

/**
 * Runs one agent's queued turns to exhaustion, one at a time, across all of
 * its conversations, highest-priority lane first. At most one drain loop
 * exists per agent, which is what enforces "one active turn per target".
 */
export function ensureAgentDrain(agentId: string): Promise<void> {
  const existing = agentDrains.get(agentId)
  if (existing) return existing
  const drain = (async () => {
    while (true) {
      const next = await findNextQueuedTurnForAgent(agentId)
      if (!next) return
      await executeTurn(next.id)
    }
  })().finally(() => {
    agentDrains.delete(agentId)
  })
  agentDrains.set(agentId, drain)
  return drain
}

/**
 * Watches one turn, forwarding visible output events until the turn reaches a
 * terminal state (or the signal aborts). Works for turns executing in this
 * process (live subscription) and for turns already finished (persisted rows).
 */
export function watchTurn(
  turnId: string,
  onEvent: (event: TurnStreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve) => {
    let settled = false
    let detach = () => {}
    // A group orchestration turn succeeds without visible output; the watch
    // hands off to its child turn, so this can move past the original id.
    let currentTurnId = turnId
    const finish = () => {
      if (settled) return
      settled = true
      detach()
      resolve()
    }
    signal?.addEventListener('abort', finish, { once: true })

    // Synchronous attach: no awaits between lookup and subscribe, so the
    // executor cannot emit between the replay and the subscription.
    const tryAttach = () => {
      const active = activeTurns.get(currentTurnId)
      if (!active) return false
      for (const message of active.delivered) onEvent({ type: 'message', message })
      const subscriber = (event: TurnStreamEvent) => {
        onEvent(event)
        if (event.type !== 'message') finish()
      }
      active.subscribers.add(subscriber)
      detach = () => active.subscribers.delete(subscriber)
      return true
    }

    const poll = async () => {
      // A turn can be `running` with no in-process executor only when a
      // stale claim survived a dev-server module reload; give a real claim a
      // grace period to register, then stop the watch instead of spinning.
      let orphanedRunningPolls = 0
      while (!settled) {
        if (tryAttach()) return
        const turn = await getTurn(currentTurnId)
        if (settled) return
        if (!turn) {
          onEvent({ type: 'error', message: `Turn ${currentTurnId} not found` })
          return finish()
        }
        if (turn.status === 'succeeded') {
          const rows = await listConversationMessages(turn.conversationId)
          const turnRows = rows.filter((m) => m.turnId === currentTurnId)
          const deliveries = turnRows.filter(
            (m) => m.payloadJson.deliveryKind === 'send-message',
          )
          if (deliveries.length > 0) {
            for (const message of deliveries) onEvent({ type: 'message', message })
            onEvent({ type: 'done', turnId: currentTurnId })
            return finish()
          }
          // A group orchestration turn succeeds by delegating: follow the
          // newest child turn (the selected member's answer) instead.
          const child = (await findChildTurns(currentTurnId)).at(-1)
          if (child) {
            currentTurnId = child.id
            ensureDrainForTurn(child)
            continue
          }
          // Pre-SendMessage turns persisted one assistant row at finalize.
          const legacy = turnRows
            .filter((m) => m.kind === 'message' && m.role === 'assistant')
            .at(-1)
          if (legacy) onEvent({ type: 'message', message: legacy })
          // A turn may legitimately succeed with nothing delivered (the
          // nudges gave up); the watch still settles cleanly.
          onEvent({ type: 'done', turnId: currentTurnId })
          return finish()
        }
        if (turn.status === 'failed' || turn.status === 'cancelled') {
          const stored =
            turn.errorJson && typeof turn.errorJson.message === 'string'
              ? turn.errorJson.message
              : `Turn ${turn.status}`
          onEvent({ type: 'error', message: stored, status: turn.status })
          return finish()
        }
        if (turn.status === 'waiting') {
          if (!turn.waitingStateJson) {
            onEvent({ type: 'error', message: 'Turn is waiting without interaction state' })
          } else {
            onEvent({
              type: 'waiting',
              turnId: turn.id,
              state: waitingStateSchema.parse(turn.waitingStateJson),
            })
          }
          return finish()
        }
        if (turn.status === 'running') {
          orphanedRunningPolls += 1
          if (orphanedRunningPolls > 25) {
            onEvent({
              type: 'error',
              message:
                'This turn is running but unreachable from this server context; reload once it completes.',
            })
            return finish()
          }
        } else {
          orphanedRunningPolls = 0
          // Queued (or recovering) but not executing here yet: kick the
          // target's drain and look again shortly.
          ensureDrainForTurn(turn)
        }
        await new Promise((r) => setTimeout(r, 200))
      }
    }
    void poll()
  })
}

// Recovery: interrupted running turns were already reset to queued by the
// database startup path. This restarts their agents' drains the first time
// any server code path calls it after a restart — there is no dedicated boot
// hook yet, so queued work resumes on the first client request rather than at
// process start. Claiming is database-atomic, so a duplicate drain (e.g.
// after a dev-server module reload) cannot double-run a turn.
let recoveryStarted = false
export function recoverQueuedTurns() {
  if (recoveryStarted) return
  recoveryStarted = true
  void (async () => {
    try {
      for (const turn of await listQueuedTurns()) {
        ensureDrainForTurn(turn)
      }
    } catch (error) {
      console.error('Queued-turn recovery failed', error)
    }
  })()
}
