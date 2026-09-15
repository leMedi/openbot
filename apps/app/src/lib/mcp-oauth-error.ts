import type { McpOauthErrorCode } from '@openbot/plugins'

export type McpOauthFeedbackCode =
  | McpOauthErrorCode
  | 'authorization-denied'
  | 'continuation-failed'

const messages: Record<McpOauthFeedbackCode, string> = {
  'google-workspace-not-configured':
    'Google Workspace OAuth is not configured. Set OPENBOT_GOOGLE_WORKSPACE_MCP_CLIENT_ID and OPENBOT_GOOGLE_WORKSPACE_MCP_CLIENT_SECRET, then restart OpenBot.',
  'authorization-denied': 'Authorization was cancelled or denied. No account was connected.',
  'authorization-invalid':
    'The authorization session is invalid or expired. Start the connection again.',
  'authorization-start-failed':
    'Could not start authorization. Check the server configuration and try again.',
  'authorization-completion-failed':
    'Authorization could not be completed. Try again and verify the OAuth configuration.',
  'continuation-failed':
    'The account was connected, but OpenBot could not resume the original task. Grant the account from Plugins and retry your request.',
}

export function mcpOauthErrorMessage(code: string | null) {
  return messages[code as McpOauthFeedbackCode] ?? messages['authorization-completion-failed']
}
