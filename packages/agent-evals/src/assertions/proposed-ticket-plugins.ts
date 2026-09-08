import { toolCalls, type EvalAssertion } from '../types'

export function pluginNames(searchResult: string) {
  return [...searchResult.matchAll(/^(?:-\s+)?\S+: ([^—\n]+) —/gm)]
    .map((match) => match[1]!.trim())
}

const assertion: EvalAssertion = (output, context) => {
  const available = toolCalls(context, 'SearchPlugins')
    .filter((search) => search.result?.isError === false)
    .flatMap((search) => pluginNames(search.result!.text))
  const response = output.toLowerCase()
  const mentioned = [...new Set(available)]
    .filter((plugin) => response.includes(plugin.toLowerCase()))
  const asksForSelection = (
    /\b(which|what)\b[^?]{0,200}\?/is.test(output) ||
    /\b(choose|select|tell me)\b/i.test(output)
  )
  const pass = mentioned.length >= 2 && asksForSelection

  return {
    pass,
    score: pass ? 1 : 0,
    reason: pass
      ? `PO proposed available ticketing plugins: ${mentioned.join(', ')}`
      : `Expected at least two plugins returned by SearchPlugins and a request to choose or connect one; found: ${mentioned.join(', ') || 'none'}`,
  }
}

export default assertion
