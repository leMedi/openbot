export type TurnPolicy = {
  history: 'main' | 'isolated-worker'
  silenceAllowed: boolean
}

/** Model/delivery policy shared by all turn sources. */
export function resolveTurnPolicy(input: { source: string }): TurnPolicy {
  if (input.source === 'subagent') {
    return {
      history: 'isolated-worker',
      silenceAllowed: false,
    }
  }
  const visibleDeliveryRequired =
    input.source === 'composer' || input.source === 'group-orchestrator'
  return {
    history: 'main',
    silenceAllowed: !visibleDeliveryRequired,
  }
}
