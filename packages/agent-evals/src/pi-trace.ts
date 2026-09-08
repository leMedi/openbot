import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import type { EvalToolCall } from './types'

type SessionEntry = {
  type?: unknown
  message?: {
    role?: unknown
    content?: unknown
    toolCallId?: unknown
    toolName?: unknown
    isError?: unknown
  }
}

function resultText(content: unknown) {
  if (!Array.isArray(content)) return ''
  return content.flatMap((part) => {
    if (!part || typeof part !== 'object' || !('type' in part)) return []
    if (part.type === 'text' && 'text' in part && typeof part.text === 'string') return [part.text]
    if (part.type === 'image') return ['[image]']
    return []
  }).join('\n')
}

export function toolTraceFromJsonLines(contents: string) {
  const calls: EvalToolCall[] = []
  const byId = new Map<string, EvalToolCall>()

  for (const line of contents.split('\n')) {
    if (!line.trim()) continue
    const entry = JSON.parse(line) as SessionEntry
    if (entry.type !== 'message' || !entry.message) continue
    const message = entry.message

    if (message.role === 'assistant' && Array.isArray(message.content)) {
      for (const part of message.content) {
        if (!part || typeof part !== 'object') continue
        if (!('type' in part) || part.type !== 'toolCall') continue
        if (!('id' in part) || typeof part.id !== 'string') continue
        if (!('name' in part) || typeof part.name !== 'string') continue
        const call: EvalToolCall = {
          id: part.id,
          name: part.name,
          arguments: 'arguments' in part ? part.arguments : {},
        }
        calls.push(call)
        byId.set(call.id, call)
      }
    }

    if (
      message.role === 'toolResult' &&
      typeof message.toolCallId === 'string'
    ) {
      const call = byId.get(message.toolCallId)
      if (call) {
        call.result = {
          text: resultText(message.content),
          isError: message.isError === true,
        }
      }
    }
  }
  return calls
}

export async function readPiToolTrace(sessionDirectory: string) {
  const files = (await readdir(sessionDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl'))
    .map((entry) => entry.name)
    .sort()
  const traces = await Promise.all(
    files.map(async (file) => toolTraceFromJsonLines(await readFile(path.join(sessionDirectory, file), 'utf8'))),
  )
  return traces.flat()
}
