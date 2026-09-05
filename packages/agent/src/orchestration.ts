export function parseOrchestratorAgentIds(
  response: string,
  allowedAgentIds: ReadonlySet<string>,
) {
  const start = response.indexOf('{')
  const end = response.lastIndexOf('}')
  if (start < 0 || end <= start) return undefined
  try {
    const parsed = JSON.parse(response.slice(start, end + 1)) as { agentIds?: unknown }
    if (!Array.isArray(parsed.agentIds)) return undefined
    const selected = parsed.agentIds.filter(
      (id): id is string => typeof id === 'string' && allowedAgentIds.has(id),
    )
    return [...new Set(selected)]
  } catch {
    return undefined
  }
}
