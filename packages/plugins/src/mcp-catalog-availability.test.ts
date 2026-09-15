import { describe, expect, it } from 'vitest'
import {
  availableMcpCatalogEntries,
  googleWorkspaceMcpConfigured,
} from './mcp-catalog-availability'

describe('Google Workspace MCP availability', () => {
  it('requires both OAuth client credentials', () => {
    expect(googleWorkspaceMcpConfigured({})).toBe(false)
    expect(googleWorkspaceMcpConfigured({
      OPENBOT_GOOGLE_WORKSPACE_MCP_CLIENT_ID: 'client-id',
    })).toBe(false)
    expect(googleWorkspaceMcpConfigured({
      OPENBOT_GOOGLE_WORKSPACE_MCP_CLIENT_SECRET: 'client-secret',
    })).toBe(false)
    expect(googleWorkspaceMcpConfigured({
      OPENBOT_GOOGLE_WORKSPACE_MCP_CLIENT_ID: '   ',
      OPENBOT_GOOGLE_WORKSPACE_MCP_CLIENT_SECRET: 'client-secret',
    })).toBe(false)
    expect(googleWorkspaceMcpConfigured({
      OPENBOT_GOOGLE_WORKSPACE_MCP_CLIENT_ID: 'client-id',
      OPENBOT_GOOGLE_WORKSPACE_MCP_CLIENT_SECRET: 'client-secret',
    })).toBe(true)
  })

  it('hides only Google Workspace entries when credentials are unavailable', () => {
    const keys = availableMcpCatalogEntries({}).map((entry) => entry.key)

    expect(keys).not.toContain('gmail')
    expect(keys).not.toContain('google-drive')
    expect(keys).not.toContain('google-calendar')
    expect(keys).toContain('linear')
  })

  it('includes Google Workspace entries when credentials are available', () => {
    const keys = availableMcpCatalogEntries({
      OPENBOT_GOOGLE_WORKSPACE_MCP_CLIENT_ID: 'client-id',
      OPENBOT_GOOGLE_WORKSPACE_MCP_CLIENT_SECRET: 'client-secret',
    }).map((entry) => entry.key)

    expect(keys).toEqual(expect.arrayContaining([
      'gmail',
      'google-drive',
      'google-calendar',
    ]))
  })
})
