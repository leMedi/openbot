import { toolCalls, type EvalAssertion } from '../types'

const assertion: EvalAssertion = (_output, context) => {
  const searches = toolCalls(context, 'SearchPlugins')
  const relevant = searches.find((search) => {
    const query = search.arguments && typeof search.arguments === 'object' && 'query' in search.arguments
      ? String(search.arguments.query)
      : ''
    return search.result?.isError === false && /\b(ticket|issue|task)s?\b/i.test(query)
  })
  if (!relevant) {
    return {
      pass: false,
      score: 0,
      reason: searches.length === 0
        ? 'PO did not call SearchPlugins'
        : 'PO made no successful ticket-related SearchPlugins call',
    }
  }
  const query = String((relevant.arguments as { query: unknown }).query)
  return { pass: true, score: 1, reason: `PO searched the plugin catalog for "${query}"` }
}

export default assertion
