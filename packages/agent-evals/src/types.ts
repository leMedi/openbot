export type EvalAgentConfig = {
  name: string
  description: string
  model: string
}

export type EvalToolCall = {
  id: string
  name: string
  arguments: unknown
  result?: {
    text: string
    isError: boolean
  }
}

export type EvalDelivery = {
  bodyText: string
}

export type OpenBotEvalMetadata = {
  status: string
  agentId: string
  turnId: string
  toolCalls: EvalToolCall[]
  deliveries: EvalDelivery[]
  systemPromptHash?: string
  model?: string
  error?: unknown
}

export type AssertionContext = {
  providerResponse?: {
    metadata?: unknown
  }
}

export type AssertionResult = {
  pass: boolean
  score: number
  reason: string
}

export type EvalAssertion = (
  output: string,
  context: AssertionContext,
) => AssertionResult

export function evalMetadata(context: AssertionContext): OpenBotEvalMetadata | undefined {
  const metadata = context.providerResponse?.metadata
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return undefined
  return metadata as OpenBotEvalMetadata
}

export function toolCalls(context: AssertionContext, name: string) {
  return evalMetadata(context)?.toolCalls.filter((call) => call.name === name) ?? []
}
