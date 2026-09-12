import { describe, expect, it } from 'vitest'
import { findMcpCatalogEntry } from './mcp-catalog'

describe('Google Workspace MCP catalog entries', () => {
  it.each([
    ['gmail', 'https://gmailmcp.googleapis.com/mcp/v1'],
    ['google-drive', 'https://drivemcp.googleapis.com/mcp/v1'],
    ['google-calendar', 'https://calendarmcp.googleapis.com/mcp/v1'],
  ])('configures %s as a Google-hosted OAuth server', (key, url) => {
    const entry = findMcpCatalogEntry(key)

    expect(entry).toBeDefined()
    expect(entry?.url).toBe(url)
    expect(entry?.auth).toEqual([
      expect.objectContaining({
        type: 'oauth',
        provider: 'google-workspace',
        scopes: expect.any(Array),
      }),
    ])
  })
})
