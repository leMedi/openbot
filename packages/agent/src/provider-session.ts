import type { Api, Model } from '@earendil-works/pi-ai'

const OPENCODE_HOST = 'opencode.ai'

function hasOpenCodeHost(baseUrl: string) {
  try {
    return new URL(baseUrl).hostname === OPENCODE_HOST
  } catch {
    return false
  }
}

/** Session routing required by OpenCode for model calls outside Pi's AgentSession. */
export function openCodeSessionHeaders(
  model: Pick<Model<Api>, 'provider' | 'baseUrl'>,
  sessionId: string,
) {
  if (
    model.provider !== 'opencode' &&
    model.provider !== 'opencode-go' &&
    !hasOpenCodeHost(model.baseUrl)
  ) {
    return undefined
  }
  return {
    'x-opencode-session': sessionId,
    'x-opencode-client': 'openbot',
  }
}
