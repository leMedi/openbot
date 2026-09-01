import {
  createMcpApiKeyAccount,
  createMcpServer,
  deleteMcpAccount,
  deleteMcpServer,
  listMcpAccounts,
  listMcpGrants,
  listMcpServers,
  setAgentMcpAccounts,
  updateMcpAccount,
  updateMcpServer,
} from '@openbot/db'
import {
  findMcpCatalogEntry,
  matchesMcpCatalogEntry,
  mcpCatalogServerConfiguration,
} from './mcp-catalog'
import {
  agentMcpAccountsInput,
  mcpAccountUpdateInput,
  mcpApiKeyAccountCreateInput,
  mcpCatalogInstallInput,
  mcpIdInput,
  mcpServerCreateInput,
  mcpServerUpdateInput,
} from './contract'

export async function readConfiguration() {
  const [servers, accounts, grants] = await Promise.all([
    listMcpServers(),
    listMcpAccounts(),
    listMcpGrants(),
  ])
  return { servers, accounts, grants }
}

export function createServer(input: unknown) {
  return createMcpServer(mcpServerCreateInput.parse(input))
}

export async function installCatalogServer(input: unknown) {
  const { key } = mcpCatalogInstallInput.parse(input)
  const entry = findMcpCatalogEntry(key)
  if (!entry) throw new Error(`Unknown MCP catalog entry: ${key}`)

  const existing = (await listMcpServers()).find((server) => server.serverKey === entry.key)
  if (existing) {
    if (matchesMcpCatalogEntry(entry, existing)) return existing
    throw new Error(`The MCP server key "${entry.key}" is already used by a custom server`)
  }

  try {
    return await createMcpServer({
      serverKey: entry.key,
      name: entry.name,
      transport: 'streamable_http',
      configuration: mcpCatalogServerConfiguration(entry),
    })
  } catch (cause) {
    const concurrentlyInstalled = (await listMcpServers()).find(
      (server) => server.serverKey === entry.key,
    )
    if (concurrentlyInstalled && matchesMcpCatalogEntry(entry, concurrentlyInstalled)) {
      return concurrentlyInstalled
    }
    throw cause
  }
}

export async function changeServer(input: unknown) {
  const data = mcpServerUpdateInput.parse(input)
  const updated = await updateMcpServer(data.id, data.patch)
  if (!updated) throw new Error(`MCP server ${data.id} not found`)
  return updated
}

export async function removeServer(input: unknown) {
  const { id } = mcpIdInput.parse(input)
  if (!(await deleteMcpServer(id))) throw new Error(`MCP server ${id} not found`)
  return { id }
}

export function createAccount(input: unknown) {
  return createMcpApiKeyAccount(mcpApiKeyAccountCreateInput.parse(input))
}

export async function changeAccount(input: unknown) {
  const data = mcpAccountUpdateInput.parse(input)
  const updated = await updateMcpAccount(data.id, data.patch)
  if (!updated) throw new Error(`MCP account ${data.id} not found`)
  return updated
}

export async function removeAccount(input: unknown) {
  const { id } = mcpIdInput.parse(input)
  if (!(await deleteMcpAccount(id))) throw new Error(`MCP account ${id} not found`)
  return { id }
}

export function replaceAgentAccounts(input: unknown) {
  const data = agentMcpAccountsInput.parse(input)
  return setAgentMcpAccounts(data.agentId, data.accountIds)
}
