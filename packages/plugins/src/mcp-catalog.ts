import { siClickup, siLinear, siNotion } from 'simple-icons'

export type McpCatalogOauthAuth = {
  type: 'oauth'
  label: string
  connectLabel: string
  accountLabel: {
    label: string
    placeholder: string
  }
}

export type McpCatalogApiKeyAuth = {
  type: 'apiKey'
  label: string
  accountLabel: {
    label: string
    placeholder: string
  }
  apiKey: {
    label: string
    placeholder: string
  }
  header: string
  prefix: 'Bearer' | ''
}

export type McpCatalogAuth = McpCatalogOauthAuth | McpCatalogApiKeyAuth

export type McpCatalogEntry = {
  key: string
  name: string
  description: string
  auth: readonly McpCatalogAuth[]
  url: string
  icon: {
    path: string
    color: `#${string}`
  }
  skills: readonly string[]
}

export const MCP_CATALOG = [
  {
    key: 'linear',
    name: 'Linear',
    description: 'Plan product work and keep engineering projects moving.',
    auth: [
      {
        type: 'oauth',
        label: 'OAuth',
        connectLabel: 'Connect Linear',
        accountLabel: { label: 'Account label', placeholder: 'e.g. Product workspace' },
      },
      {
        type: 'apiKey',
        label: 'API key',
        accountLabel: { label: 'Account label', placeholder: 'e.g. Product workspace' },
        apiKey: { label: 'Linear API key', placeholder: 'lin_api_...' },
        header: 'Authorization',
        prefix: 'Bearer',
      },
    ],
    url: 'https://mcp.linear.app/mcp',
    icon: { path: siLinear.path, color: `#${siLinear.hex}` },
    skills: ['Search issues', 'Create and update issues', 'Manage projects', 'Add comments'],
  },
  {
    key: 'clickup',
    name: 'ClickUp',
    description: 'Work with tasks, docs, chat, and time tracking across your workspace.',
    auth: [{
      type: 'oauth',
      label: 'OAuth',
      connectLabel: 'Connect ClickUp',
      accountLabel: { label: 'Account label', placeholder: 'e.g. Marketing workspace' },
    }],
    url: 'https://mcp.clickup.com/mcp',
    icon: { path: siClickup.path, color: `#${siClickup.hex}` },
    skills: ['Search the workspace', 'Manage tasks', 'Read docs and chat', 'Track time'],
  },
  {
    key: 'notion',
    name: 'Notion',
    description: 'Search, read, and update knowledge in your Notion workspace.',
    auth: [{
      type: 'oauth',
      label: 'OAuth',
      connectLabel: 'Connect Notion',
      accountLabel: { label: 'Account label', placeholder: 'e.g. Team workspace' },
    }],
    url: 'https://mcp.notion.com/mcp',
    icon: { path: siNotion.path, color: `#${siNotion.hex}` },
    skills: ['Search workspace content', 'Read and update pages', 'Manage databases', 'Add comments'],
  },
] as const satisfies readonly McpCatalogEntry[]

export type McpCatalogKey = (typeof MCP_CATALOG)[number]['key']

export function findMcpCatalogEntry(key: string): McpCatalogEntry | undefined {
  return MCP_CATALOG.find((entry) => entry.key === key)
}

export function mcpCatalogServerConfiguration(entry: McpCatalogEntry) {
  const apiKey = entry.auth.find((auth) => auth.type === 'apiKey')
  return {
    version: 1 as const,
    url: entry.url,
    apiKeyHeader: apiKey?.header ?? 'Authorization',
    apiKeyPrefix: apiKey?.prefix ?? 'Bearer',
  }
}

export function matchesMcpCatalogEntry(
  entry: McpCatalogEntry,
  server: { serverKey: string; transport?: string; configurationJson: unknown },
) {
  if (
    server.serverKey !== entry.key ||
    (server.transport !== undefined && server.transport !== 'streamable_http') ||
    typeof server.configurationJson !== 'object'
  ) return false
  const configuration = server.configurationJson as Record<string, unknown>
  const expected = mcpCatalogServerConfiguration(entry)
  return (
    configuration.version === expected.version &&
    configuration.url === expected.url &&
    configuration.apiKeyHeader === expected.apiKeyHeader &&
    configuration.apiKeyPrefix === expected.apiKeyPrefix
  )
}
