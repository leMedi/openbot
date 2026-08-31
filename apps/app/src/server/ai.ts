import type { ModelMessage } from '@openbot/db'

// Inference goes through one OpenAI-compatible chat-completions endpoint
// fixed by server configuration; there is no per-agent provider selection yet.
export type AiConfig = {
  baseUrl: string
  apiKey: string
  model: string
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

/**
 * Streams one chat completion, invoking onDelta for each visible text chunk,
 * and resolves with the full assistant text. Credentials never leave this
 * module; callers only see message content.
 */
export async function streamChatCompletion(
  config: AiConfig,
  messages: ModelMessage[],
  onDelta: (text: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({ model: config.model, messages, stream: true }),
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

  const consumeLine = (line: string) => {
    if (!line.startsWith('data:')) return false
    const data = line.slice(5).trim()
    if (data === '[DONE]') return true
    try {
      const parsed = JSON.parse(data) as {
        choices?: { delta?: { content?: unknown } }[]
      }
      const delta = parsed.choices?.[0]?.delta?.content
      if (typeof delta === 'string' && delta.length > 0) {
        fullText += delta
        onDelta(delta)
      }
    } catch {
      // Ignore comments, keep-alives, and non-JSON frames.
    }
    return false
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let newline = buffer.indexOf('\n')
    while (newline !== -1) {
      const line = buffer.slice(0, newline).trim()
      buffer = buffer.slice(newline + 1)
      if (consumeLine(line)) return fullText
      newline = buffer.indexOf('\n')
    }
  }
  return fullText
}
