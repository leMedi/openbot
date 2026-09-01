import type { ModelMessage, ModelToolCall, ToolDefinition } from '@openbot/db'

export type { ToolDefinition }

// Inference goes through one OpenAI-compatible chat-completions endpoint
// fixed by server configuration; there is no per-agent provider selection yet.
export type AiConfig = {
  baseUrl: string
  apiKey: string
  model: string
}

export type ChatCompletion = {
  text: string
  toolCalls: ModelToolCall[]
}

/** OpenAI-compatible tool_choice forcing one specific function. */
export type ToolChoice = {
  type: 'function'
  function: { name: string }
}

export function getAiConfig(): AiConfig {
  const baseUrl = process.env.OPENBOT_AI_BASE_URL
  const apiKey = process.env.OPENBOT_AI_API_KEY
  const model = process.env.OPENBOT_AI_MODEL
  if (!baseUrl || !apiKey || !model) {
    throw new Error(
      'OPENBOT_AI_BASE_URL, OPENBOT_AI_API_KEY, and OPENBOT_AI_MODEL must be configured',
    )
  }
  return { baseUrl: baseUrl.replace(/\/+$/, ''), apiKey, model }
}

type StreamedToolCallDelta = {
  index?: number
  id?: string
  function?: { name?: string; arguments?: string }
}

/**
 * Streams one chat completion, invoking onDelta for each visible text chunk,
 * and resolves with the full assistant text plus any requested tool calls.
 * Credentials never leave this module; callers only see message content.
 */
export async function streamChatCompletion(
  config: AiConfig,
  messages: ModelMessage[],
  onDelta: (text: string) => void,
  signal?: AbortSignal,
  tools?: ToolDefinition[],
  toolChoice?: ToolChoice,
): Promise<ChatCompletion> {
  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      stream: true,
      ...(tools && tools.length > 0 && { tools }),
      ...(tools && tools.length > 0 && toolChoice && { tool_choice: toolChoice }),
    }),
    signal,
  })
  if (!response.ok || !response.body) {
    const detail = await response.text().catch(() => '')
    throw new Error(
      `Model request failed (${response.status} ${response.statusText}): ${detail.slice(0, 300)}`,
    )
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let fullText = ''
  // Tool calls stream in fragments keyed by choice index: the first fragment
  // carries id/name, later ones append argument text.
  const toolCallsByIndex = new Map<number, { id: string; name: string; args: string }>()

  const consumeToolCallDelta = (deltas: StreamedToolCallDelta[]) => {
    for (const [position, delta] of deltas.entries()) {
      const index = delta.index ?? position
      const existing = toolCallsByIndex.get(index) ?? { id: '', name: '', args: '' }
      if (delta.id) existing.id = delta.id
      if (delta.function?.name) existing.name = delta.function.name
      if (delta.function?.arguments) existing.args += delta.function.arguments
      toolCallsByIndex.set(index, existing)
    }
  }

  const consumeLine = (line: string) => {
    if (!line.startsWith('data:')) return false
    const data = line.slice(5).trim()
    if (data === '[DONE]') return true
    try {
      const parsed = JSON.parse(data) as {
        choices?: { delta?: { content?: unknown; tool_calls?: StreamedToolCallDelta[] } }[]
      }
      const delta = parsed.choices?.[0]?.delta
      if (typeof delta?.content === 'string' && delta.content.length > 0) {
        fullText += delta.content
        onDelta(delta.content)
      }
      if (Array.isArray(delta?.tool_calls)) consumeToolCallDelta(delta.tool_calls)
    } catch {
      // Ignore comments, keep-alives, and non-JSON frames.
    }
    return false
  }

  const finish = (): ChatCompletion => ({
    text: fullText,
    toolCalls: [...toolCallsByIndex.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, call]) => call)
      .filter((call) => call.id && call.name)
      .map((call) => ({
        id: call.id,
        type: 'function' as const,
        function: { name: call.name, arguments: call.args },
      })),
  })

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let newline = buffer.indexOf('\n')
    while (newline !== -1) {
      const line = buffer.slice(0, newline).trim()
      buffer = buffer.slice(newline + 1)
      if (consumeLine(line)) return finish()
      newline = buffer.indexOf('\n')
    }
  }
  return finish()
}
