import {
  appendConversationMessage,
  checkpointStateSchema,
  claimQueuedTurn,
  completeTurn,
  type ConversationMessage,
  createConversationCheckpoint,
  findNextQueuedTurn,
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
const conversationDrains = new Map<string, Promise<void>>()

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

    const assistantMessage = await appendConversationMessage({
      conversationId: conversation.id,
      kind: 'message',
      role: 'assistant',
      direction: 'outbound',
      bodyText: assistantText,
      turnId,
    })
    await createConversationCheckpoint(conversation.id, {
      version: 1,
      modelMessages: [...modelMessages, { role: 'assistant', content: assistantText }],
    })
    await completeTurn(turnId, { status: 'succeeded' })
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
 * Runs this conversation's queued turns to exhaustion, one at a time. At most
 * one drain loop exists per conversation, which is what enforces "one active
 * turn per target" in the MVP.
 */
export function ensureConversationDrain(conversationId: string): Promise<void> {
  const existing = conversationDrains.get(conversationId)
  if (existing) return existing
  const drain = (async () => {
    while (true) {
      const next = await findNextQueuedTurn(conversationId)
      if (!next) return
      await executeTurn(next.id)
    }
  })().finally(() => {
    conversationDrains.delete(conversationId)
  })
  conversationDrains.set(conversationId, drain)
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
        // Queued (or recovering) but not executing here yet: kick the drain
        // and look again shortly.
        void ensureConversationDrain(turn.conversationId)
        await new Promise((r) => setTimeout(r, 200))
      }
    }
    void poll()
  })
}

// Startup recovery: interrupted running turns were already reset to queued by
// the database startup path; restart their conversation drains so queued work
// resumes without waiting for a client. Claiming is database-atomic, so a
// duplicate drain (e.g. after dev-server module reload) cannot double-run.
let recoveryStarted = false
export function recoverQueuedTurns() {
  if (recoveryStarted) return
  recoveryStarted = true
  void (async () => {
    try {
      for (const turn of await listQueuedTurns()) {
        void ensureConversationDrain(turn.conversationId)
      }
    } catch (error) {
      console.error('Queued-turn recovery failed', error)
    }
  })()
}
