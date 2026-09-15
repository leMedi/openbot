import { MCP_CATALOG, type McpCatalogEntry } from './mcp-catalog'

export function googleWorkspaceMcpConfigured(
  environment: NodeJS.ProcessEnv = process.env,
) {
  return Boolean(
    environment.OPENBOT_GOOGLE_WORKSPACE_MCP_CLIENT_ID?.trim() &&
    environment.OPENBOT_GOOGLE_WORKSPACE_MCP_CLIENT_SECRET?.trim(),
  )
}

export function availableMcpCatalogEntries(
  environment: NodeJS.ProcessEnv = process.env,
): readonly McpCatalogEntry[] {
  const googleWorkspaceAvailable = googleWorkspaceMcpConfigured(environment)
  return MCP_CATALOG.filter((entry) =>
    googleWorkspaceAvailable ||
    !entry.auth.some(
      (auth) =>
        auth.type === 'oauth' &&
        'provider' in auth &&
        auth.provider === 'google-workspace',
    ),
  )
}
