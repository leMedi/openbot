import { createServerFn } from '@tanstack/react-start'
import {
  agentMcpAccountsInput,
  mcpAccountUpdateInput,
  mcpApiKeyAccountCreateInput,
  mcpIdInput,
  mcpServerCreateInput,
  mcpServerUpdateInput,
} from './mcp-contract'

export const getMcpConfiguration = createServerFn({ method: 'GET' }).handler(async () =>
  (await import('./mcp-handlers.server')).readConfiguration(),
)

export const addMcpServer = createServerFn({ method: 'POST' })
  .validator((input: unknown) => mcpServerCreateInput.parse(input))
  .handler(async ({ data }) => (await import('./mcp-handlers.server')).createServer(data))

export const changeMcpServer = createServerFn({ method: 'POST' })
  .validator((input: unknown) => mcpServerUpdateInput.parse(input))
  .handler(async ({ data }) => (await import('./mcp-handlers.server')).changeServer(data))

export const removeMcpServer = createServerFn({ method: 'POST' })
  .validator((input: unknown) => mcpIdInput.parse(input))
  .handler(async ({ data }) => (await import('./mcp-handlers.server')).removeServer(data))

export const addMcpApiKeyAccount = createServerFn({ method: 'POST' })
  .validator((input: unknown) => mcpApiKeyAccountCreateInput.parse(input))
  .handler(async ({ data }) => (await import('./mcp-handlers.server')).createAccount(data))

export const changeMcpAccount = createServerFn({ method: 'POST' })
  .validator((input: unknown) => mcpAccountUpdateInput.parse(input))
  .handler(async ({ data }) => (await import('./mcp-handlers.server')).changeAccount(data))

export const removeMcpAccount = createServerFn({ method: 'POST' })
  .validator((input: unknown) => mcpIdInput.parse(input))
  .handler(async ({ data }) => (await import('./mcp-handlers.server')).removeAccount(data))

export const updateAgentMcpAccounts = createServerFn({ method: 'POST' })
  .validator((input: unknown) => agentMcpAccountsInput.parse(input))
  .handler(async ({ data }) =>
    (await import('./mcp-handlers.server')).replaceAgentAccounts(data),
  )
