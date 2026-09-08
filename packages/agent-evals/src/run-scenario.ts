import { createHash } from 'node:crypto'
import type { EvalAgentConfig } from './types'
import { readPiToolTrace } from './pi-trace'

type ScenarioInput = {
  agent: EvalAgentConfig
  message: string
}

async function readInput() {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk))
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as ScenarioInput
}

function captureSystemPromptHash() {
  let systemPromptHash: string | undefined
  console.info = (...args: unknown[]) => {
    if (args[0] === '[agent prompt]') {
      const details = args[1]
      if (details && typeof details === 'object' && 'systemPrompt' in details) {
        const prompt = (details as { systemPrompt?: unknown }).systemPrompt
        if (typeof prompt === 'string') {
          systemPromptHash = createHash('sha256').update(prompt).digest('hex')
        }
      }
    }
  }
  console.warn = (...args: unknown[]) => process.stderr.write(`${args.map(String).join(' ')}\n`)
  console.error = (...args: unknown[]) => process.stderr.write(`${args.map(String).join(' ')}\n`)
  return () => systemPromptHash
}

const input = await readInput()
const getSystemPromptHash = captureSystemPromptHash()

try {
  // OPENBOT_DATA_DIR must be set by the parent before these modules load.
  const store = await import('@openbot/db')
  const runner = await import('@openbot/agent')
  const created = await store.createAgent({
    name: input.agent.name,
    description: input.agent.description,
    defaultModel: input.agent.model,
  })
  const accepted = await store.acceptUserMessage({
    conversationId: created.conversation.id,
    text: input.message,
  })

  await runner.ensureAgentDrain(created.agent.id)

  const [turn, transcript] = await Promise.all([
    store.getTurn(accepted.turn.id),
    store.listConversationMessages(created.conversation.id),
  ])
  if (!turn) throw new Error(`Turn ${accepted.turn.id} disappeared`)
  const toolCalls = await readPiToolTrace(
    await store.piSessionDirectory(created.conversation.id),
  )

  const deliveries = transcript
    .filter((message) =>
      message.turnId === turn.id &&
      message.direction === 'outbound' &&
      message.payloadJson.deliveryKind === 'send-message' &&
      typeof message.bodyText === 'string'
    )
    .map((message) => ({ bodyText: message.bodyText! }))

  process.stdout.write(JSON.stringify({
    output: deliveries.map((delivery) => delivery.bodyText).join('\n'),
    metadata: {
      status: turn.status,
      agentId: created.agent.id,
      turnId: turn.id,
      toolCalls,
      deliveries,
      systemPromptHash: getSystemPromptHash(),
      model: turn.modelProvider && turn.modelId
        ? `${turn.modelProvider}/${turn.modelId}`
        : input.agent.model,
      error: turn.errorJson,
    },
  }))
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
  process.exitCode = 1
}
