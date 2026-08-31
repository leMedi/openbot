import {
  appendConversationMessage,
  checkpointStateSchema,
  claimQueuedTurn,
  completeTurn,
  type ConversationMessage,
  finalizeTurnSuccess,
  findNextQueuedTurnForAgent,
  getAgent,
  getConversation,
  getCurrentCheckpoint,
  getTurn,
  listConversationMessages,
  listQueuedTurns,
  type ModelMessage,
  recordTurnExecution,
} from '@openbot/db'
import { getAiConfig, streamChatCompletion } from './ai'

// In-memory execution state. Durable truth lives in the turns table; these
// maps only fan visible output out to connected clients and serialize
// execution per conversation.
export type TurnStreamEvent =
  | { type: 'delta'; text: string }
  | { type: 'done'; message: ConversationMessage }
  | { type: 'error'; message: string }

type ActiveTurn = {
  accumulated: string
  subscribers: Set<(event: TurnStreamEvent) => void>
}

const activeTurns = new Map<string, ActiveTurn>()
const agentDrains = new Map<string, Promise<void>>()

function systemPromptFor(agent: { name: string; description: string }) {
  const description = agent.description.trim()
  return [
    `You are ${agent.name}, a helpful long-lived assistant agent.`,
    description && `Your operator describes you as: ${description}`,
    'Answer in Markdown.',
  ]
    .filter(Boolean)
    .join('\n\n')
}

async function executeTurn(turnId: string) {
  const claimed = await claimQueuedTurn(turnId)
  if (!claimed) return

  const active: ActiveTurn = { accumulated: '', subscribers: new Set() }
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
    if (!conversation?.ownerAgentId) {
      throw new Error(`Conversation ${claimed.conversationId} has no owner agent`)
    }
    const agent = await getAgent(conversation.ownerAgentId)
    if (!agent) throw new Error(`Agent ${conversation.ownerAgentId} not found`)

    const config = getAiConfig()
    // Historical snapshot of what this execution actually used. No tools are
    // wired up yet, so the effective tool list is honestly empty.
    await recordTurnExecution(turnId, {
      modelProvider: 'openai-compatible',
      modelId: config.model,
      effectiveTools: { version: 1, tools: [] },
      effectivePermissions: { version: 1, approvalMode: agent.approvalMode },
      runtimeContext: {
        version: 1,
        baseUrl: config.baseUrl,
        lane: claimed.lane,
        mode: claimed.mode,
      },
    })

    // Model-facing input: the current checkpoint's frozen history (or a fresh
    // system prompt on the first turn) plus this turn's user messages.
    const checkpoint = await getCurrentCheckpoint(conversation.id)
    const priorMessages: ModelMessage[] = checkpoint
      ? checkpointStateSchema.parse(checkpoint.stateJson).modelMessages
      : [{ role: 'system', content: systemPromptFor(agent) }]
    const turnUserMessages: ModelMessage[] = (
      await listConversationMessages(conversation.id)
    )
      .filter((m) => m.turnId === turnId && m.kind === 'message' && m.role === 'user')
      .map((m) => ({ role: 'user', content: m.bodyText ?? '' }))
    const modelMessages = [...priorMessages, ...turnUserMessages]

    const assistantText = await streamChatCompletion(config, modelMessages, (delta) => {
      active.accumulated += delta
      emit({ type: 'delta', text: delta })
    })

    // One transaction: assistant row, next checkpoint (pointer advance), and
    // the succeeded status — so a crash never persists a partial outcome.
    const { message: assistantMessage } = await finalizeTurnSuccess({
      turnId,
      conversationId: conversation.id,
      assistantText,
      checkpointState: {
        version: 1,
        modelMessages: [...modelMessages, { role: 'assistant', content: assistantText }],
      },
    })
    emitTerminal({ type: 'done', message: assistantMessage })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Turn execution failed'
    await completeTurn(turnId, {
      status: 'failed',
      error: { version: 1, message },
    }).catch(() => {})
    await appendConversationMessage({
      conversationId: claimed.conversationId,
      kind: 'status',
      direction: 'internal',
      bodyText: `Turn failed: ${message}`,
      payload: { version: 1, event: 'turn_failed', message },
      turnId,
    }).catch(() => {})
    emitTerminal({ type: 'error', message })
  } finally {
    activeTurns.delete(turnId)
  }
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
      const active = activeTurns.get(turnId)
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
        const turn = await getTurn(turnId)
        if (settled) return
        if (!turn) {
          onEvent({ type: 'error', message: `Turn ${turnId} not found` })
          return finish()
        }
        if (turn.status === 'succeeded') {
          const rows = await listConversationMessages(turn.conversationId)
          const assistant = rows
            .filter((m) => m.turnId === turnId && m.role === 'assistant')
            .at(-1)
          if (assistant) onEvent({ type: 'done', message: assistant })
          else {
            onEvent({
              type: 'error',
              message: 'Turn succeeded without an assistant message',
            })
          }
          return finish()
        }
        if (turn.status === 'failed' || turn.status === 'cancelled') {
          const stored =
            turn.errorJson && typeof turn.errorJson.message === 'string'
              ? turn.errorJson.message
              : `Turn ${turn.status}`
          onEvent({ type: 'error', message: stored })
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
          // agent's drain and look again shortly.
          if (turn.targetAgentId) void ensureAgentDrain(turn.targetAgentId)
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
        if (turn.targetAgentId) void ensureAgentDrain(turn.targetAgentId)
      }
    } catch (error) {
      console.error('Queued-turn recovery failed', error)
    }
  })()
}
