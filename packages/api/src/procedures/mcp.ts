import {
  agentMcpAccountsInput,
  mcpAccountUpdateInput,
  mcpApiKeyAccountCreateInput,
  mcpCatalogInstallInput,
  mcpIdInput,
  mcpServerCreateInput,
  mcpServerUpdateInput,
} from '@openbot/plugins'
import type { McpCatalogKey } from '@openbot/plugins/mcp-catalog'
import { base } from '../base'

const plugins = () => import('@openbot/plugins')

export const mcp = {
  configuration: base.handler(async () => (await plugins()).readConfiguration()),

  availableCatalogKeys: base.handler(async () => {
    const { availableMcpCatalogEntries } = await plugins()
    return availableMcpCatalogEntries().map((entry) => entry.key) as McpCatalogKey[]
  }),

  createServer: base
    .input(mcpServerCreateInput)
    .handler(async ({ input }) => (await plugins()).createServer(input)),

  installFromCatalog: base
    .input(mcpCatalogInstallInput)
    .handler(async ({ input }) => (await plugins()).installCatalogServer(input)),

  updateServer: base
    .input(mcpServerUpdateInput)
    .handler(async ({ input }) => (await plugins()).changeServer(input)),

  removeServer: base
    .input(mcpIdInput)
    .handler(async ({ input }) => (await plugins()).removeServer(input)),

  createApiKeyAccount: base
    .input(mcpApiKeyAccountCreateInput)
    .handler(async ({ input }) => (await plugins()).createAccount(input)),

  updateAccount: base
    .input(mcpAccountUpdateInput)
    .handler(async ({ input }) => (await plugins()).changeAccount(input)),

  removeAccount: base
    .input(mcpIdInput)
    .handler(async ({ input }) => (await plugins()).removeAccount(input)),

  setAgentAccounts: base
    .input(agentMcpAccountsInput)
    .handler(async ({ input }) => (await plugins()).replaceAgentAccounts(input)),
}
