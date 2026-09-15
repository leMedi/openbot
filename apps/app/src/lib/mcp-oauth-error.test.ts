import assert from 'node:assert/strict'
import test from 'node:test'
import { mcpOauthErrorMessage } from './mcp-oauth-error'

test('explains missing Google Workspace credentials', () => {
  assert.match(
    mcpOauthErrorMessage('google-workspace-not-configured'),
    /OPENBOT_GOOGLE_WORKSPACE_MCP_CLIENT_ID.*OPENBOT_GOOGLE_WORKSPACE_MCP_CLIENT_SECRET/,
  )
})

test('does not expose unknown error details', () => {
  assert.equal(
    mcpOauthErrorMessage('provider-secret-error'),
    'Authorization could not be completed. Try again and verify the OAuth configuration.',
  )
  assert.equal(
    mcpOauthErrorMessage(null),
    'Authorization could not be completed. Try again and verify the OAuth configuration.',
  )
})
