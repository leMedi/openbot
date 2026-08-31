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
  queueGroupChildTurn,
  recordTurnExecution,
  type WaitingState,
  waitingStateSchema,
} from '@openbot/db'
import { getAiConfig, streamChatCompletion } from './ai'
import { agentToolDefinitions, executeAgentToolCall } from './agent-tools'
import {
  assembleGroupModelMessages,
  assemblePrivateModelMessages,
} from './prompt-assembly'

// A turn may interleave tool calls and completions, but must settle on a
// visible answer; the final round runs without tools to force one.
const MAX_TOOL_ROUNDS = 8

// In-memory execution state. Durable truth lives in the turns table; these
// maps only fan visible output out to connected clients and serialize
// execution per target.
export type TurnStreamEvent =
  | { type: 'delta'; text: string }
  | { type: 'done'; message: ConversationMessage }
  | { type: 'waiting'; turnId: string; state: WaitingState }
  | { type: 'error'; message: string; status?: 'failed' | 'cancelled' }

type ActiveTurn = {
  accumulated: string
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
    accumulated: '',
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
    // Historical snapshot of what this execution actually used.
    await recordTurnExecution(turnId, {
      modelProvider: 'openai-compatible',
      modelId: config.model,
      effectiveTools: {
        version: 1,
        tools: agentToolDefinitions.map((tool) => tool.function.name),
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

    // Model-facing input. Group rooms rebuild the shared transcript from this
    // member's perspective; private rooms replay the checkpoint history. The
    // system prompt is re-rendered from live profile and memory every run.
    const modelMessages = group
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

    console.info('[agent prompt]', {
      agent: { id: agent.id, name: agent.name },
      model: config.model,
      prompt: modelMessages,
    })

    const onDelta = (delta: string) => {
      active.accumulated += delta
      emit({ type: 'delta', text: delta })
    }

    // Completion/tool loop: each round may answer or request tool calls;
    // tool results are appended and the model is called again.
    const visibleTexts: string[] = []
    let finalText = ''
    for (let round = 0; ; round += 1) {
      const allowTools = round < MAX_TOOL_ROUNDS
      const completion = await streamChatCompletion(
        config,
        modelMessages,
        onDelta,
        active.controller.signal,
        allowTools ? agentToolDefinitions : undefined,
      )
      if (completion.text) visibleTexts.push(completion.text)
      if (completion.toolCalls.length === 0) {
        finalText = completion.text
        break
      }
      modelMessages.push({
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
        modelMessages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: await executeAgentToolCall(agent, toolCall),
        })
      }
    }
    // The visible transcript row carries everything the user watched stream.
    const assistantText = visibleTexts.join('\n\n')

    // One transaction: assistant row, next checkpoint (pointer advance), and
    // the succeeded status — so a crash never persists a partial outcome.
    const { message: assistantMessage } = await finalizeTurnSuccess({
      turnId,
      conversationId: conversation.id,
      assistantText,
      // In a shared group room the transcript must carry the member's
      // identity; in a private room the owning agent is implied.
      senderAgentId: group ? agent.id : null,
      checkpointState: {
        version: 1,
        modelMessages: [...modelMessages, { role: 'assistant', content: finalText }],
      },
    })
    emitTerminal({ type: 'done', message: assistantMessage })
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
      if (active.accumulated) onEvent({ type: 'delta', text: active.accumulated })
      const subscriber = (event: TurnStreamEvent) => {
        onEvent(event)
        if (event.type !== 'delta') finish()
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
          const assistant = rows
            .filter((m) => m.turnId === currentTurnId && m.role === 'assistant')
            .at(-1)
          if (assistant) {
            onEvent({ type: 'done', message: assistant })
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
          onEvent({
            type: 'error',
            message: 'Turn succeeded without an assistant message',
          })
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
