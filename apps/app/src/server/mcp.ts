import {
  agentMcpAccountsInput,
  mcpAccountUpdateInput,
  mcpApiKeyAccountCreateInput,
  mcpCatalogInstallInput,
  mcpIdInput,
  mcpServerCreateInput,
  mcpServerUpdateInput,
} from '@openbot/plugins'
import { createServerFn } from '@tanstack/react-start'

export const getMcpConfiguration = createServerFn({ method: 'GET' }).handler(async () =>
  (await import('@openbot/plugins')).readConfiguration(),
)

export const addMcpServer = createServerFn({ method: 'POST' })
  .validator((input: unknown) => mcpServerCreateInput.parse(input))
  .handler(async ({ data }) => (await import('@openbot/plugins')).createServer(data))

export const installMcpFromCatalog = createServerFn({ method: 'POST' })
  .validator((input: unknown) => mcpCatalogInstallInput.parse(input))
  .handler(async ({ data }) => (await import('@openbot/plugins')).installCatalogServer(data))

export const changeMcpServer = createServerFn({ method: 'POST' })
  .validator((input: unknown) => mcpServerUpdateInput.parse(input))
  .handler(async ({ data }) => (await import('@openbot/plugins')).changeServer(data))

export const removeMcpServer = createServerFn({ method: 'POST' })
  .validator((input: unknown) => mcpIdInput.parse(input))
  .handler(async ({ data }) => (await import('@openbot/plugins')).removeServer(data))

export const addMcpApiKeyAccount = createServerFn({ method: 'POST' })
  .validator((input: unknown) => mcpApiKeyAccountCreateInput.parse(input))
  .handler(async ({ data }) => (await import('@openbot/plugins')).createAccount(data))

export const changeMcpAccount = createServerFn({ method: 'POST' })
  .validator((input: unknown) => mcpAccountUpdateInput.parse(input))
  .handler(async ({ data }) => (await import('@openbot/plugins')).changeAccount(data))

export const removeMcpAccount = createServerFn({ method: 'POST' })
  .validator((input: unknown) => mcpIdInput.parse(input))
  .handler(async ({ data }) => (await import('@openbot/plugins')).removeAccount(data))

export const updateAgentMcpAccounts = createServerFn({ method: 'POST' })
  .validator((input: unknown) => agentMcpAccountsInput.parse(input))
  .handler(async ({ data }) =>
    (await import('@openbot/plugins')).replaceAgentAccounts(data),
  )
