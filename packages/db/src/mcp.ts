import { and, asc, eq, inArray } from 'drizzle-orm'
import * as z from 'zod'
import { db } from './client'
import { createId } from './ids'
import { apiKeyCredentialsSchema } from './json-schemas'
import * as schema from './schema'

export const mcpTransportSchema = z.literal('streamable_http')

export const mcpStreamableHttpConfigurationSchema = z
  .object({
    version: z.literal(1),
    url: z.url().refine((value) => {
      const url = new URL(value)
      return (
        (url.protocol === 'http:' || url.protocol === 'https:') &&
        !url.username &&
        !url.password
      )
    }, 'MCP URL must be HTTP(S) and cannot contain credentials'),
    apiKeyHeader: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .regex(/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/)
      .default('Authorization'),
    apiKeyPrefix: z.enum(['Bearer', '']).default('Bearer'),
  })
  .strict()

export const mcpServerCreateSchema = z.object({
  serverKey: z.string().trim().min(1).max(100).regex(/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/),
  name: z.string().trim().min(1).max(200),
  transport: mcpTransportSchema,
  configuration: mcpStreamableHttpConfigurationSchema,
  enabled: z.boolean().optional(),
})

export const mcpServerUpdateSchema = z
  .object({
    serverKey: mcpServerCreateSchema.shape.serverKey.optional(),
    name: mcpServerCreateSchema.shape.name.optional(),
    transport: mcpTransportSchema.optional(),
    configuration: mcpStreamableHttpConfigurationSchema.optional(),
    enabled: z.boolean().optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, 'An MCP server update is required')

export const mcpApiKeyAccountCreateSchema = z.object({
  serverId: z.string().min(1),
  label: z.string().trim().min(1).max(200),
  apiKey: z
    .string()
    .min(1)
    .max(20_000)
    .refine((value) => !/[\0\r\n]/.test(value), 'API key contains invalid characters'),
})

export const mcpAccountUpdateSchema = z
  .object({
    label: mcpApiKeyAccountCreateSchema.shape.label.optional(),
    apiKey: mcpApiKeyAccountCreateSchema.shape.apiKey.optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, 'An MCP account update is required')

export type McpServerCreateInput = z.input<typeof mcpServerCreateSchema>
export type McpServerUpdate = z.input<typeof mcpServerUpdateSchema>
export type McpApiKeyAccountCreateInput = z.input<typeof mcpApiKeyAccountCreateSchema>
export type McpAccountUpdate = z.input<typeof mcpAccountUpdateSchema>
export type McpStreamableHttpConfiguration = z.infer<
  typeof mcpStreamableHttpConfigurationSchema
>
export type RuntimeMcpAccount = {
  accountId: string
  accountLabel: string
  serverId: string
  serverKey: string
  serverName: string
  transport: 'streamable_http'
  configuration: McpStreamableHttpConfiguration
  credentials: z.infer<typeof apiKeyCredentialsSchema>
}

const safeAccountSelection = {
  id: schema.mcpAccounts.id,
  serverId: schema.mcpAccounts.serverId,
  label: schema.mcpAccounts.label,
  authType: schema.mcpAccounts.authType,
  tokenExpiresAt: schema.mcpAccounts.tokenExpiresAt,
  status: schema.mcpAccounts.status,
  createdAt: schema.mcpAccounts.createdAt,
  updatedAt: schema.mcpAccounts.updatedAt,
}

export type SafeMcpAccount = {
  id: string
  serverId: string
  label: string
  authType: string
  tokenExpiresAt: number | null
  status: string
  createdAt: number
  updatedAt: number
}

export type SafeMcpServer = {
  id: string
  serverKey: string
  name: string
  transport: 'streamable_http'
  configurationJson: McpStreamableHttpConfiguration
  enabled: boolean
  createdAt: number
  updatedAt: number
}

function safeServer(server: schema.McpServer): SafeMcpServer {
  return {
    ...server,
    transport: mcpTransportSchema.parse(server.transport),
    configurationJson: mcpStreamableHttpConfigurationSchema.parse(
      server.configurationJson,
    ),
  }
}

export async function listMcpServers() {
  const servers = await db
    .select()
    .from(schema.mcpServers)
    .orderBy(asc(schema.mcpServers.createdAt), asc(schema.mcpServers.id))
  return servers.map(safeServer)
}

export async function getMcpServer(id: string) {
  const [server] = await db
    .select()
    .from(schema.mcpServers)
    .where(eq(schema.mcpServers.id, id))
    .limit(1)
  return server ? safeServer(server) : undefined
}

export async function createMcpServer(input: McpServerCreateInput) {
  const validated = mcpServerCreateSchema.parse(input)
  const now = Date.now()
  const [created] = await db
    .insert(schema.mcpServers)
    .values({
      id: createId('mcp'),
      serverKey: validated.serverKey,
      name: validated.name,
      transport: validated.transport,
      configurationJson: validated.configuration,
      enabled: validated.enabled ?? true,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
  return safeServer(created)
}

export async function updateMcpServer(id: string, patch: McpServerUpdate) {
  const validated = mcpServerUpdateSchema.parse(patch)
  const [updated] = await db
    .update(schema.mcpServers)
    .set({
      ...(validated.serverKey !== undefined && { serverKey: validated.serverKey }),
      ...(validated.name !== undefined && { name: validated.name }),
      ...(validated.transport !== undefined && { transport: validated.transport }),
      ...(validated.configuration !== undefined && {
        configurationJson: validated.configuration,
      }),
      ...(validated.enabled !== undefined && { enabled: validated.enabled }),
      updatedAt: Date.now(),
    })
    .where(eq(schema.mcpServers.id, id))
    .returning()
  return updated ? safeServer(updated) : undefined
}

export async function deleteMcpServer(id: string) {
  const deleted = await db
    .delete(schema.mcpServers)
    .where(eq(schema.mcpServers.id, id))
    .returning({ id: schema.mcpServers.id })
  return deleted.length > 0
}

export function listMcpAccounts(serverId?: string): Promise<SafeMcpAccount[]> {
  return db
    .select(safeAccountSelection)
    .from(schema.mcpAccounts)
    .where(serverId ? eq(schema.mcpAccounts.serverId, serverId) : undefined)
    .orderBy(asc(schema.mcpAccounts.createdAt), asc(schema.mcpAccounts.id))
}

export async function getMcpAccount(id: string): Promise<SafeMcpAccount | undefined> {
  const [account] = await db
    .select(safeAccountSelection)
    .from(schema.mcpAccounts)
    .where(eq(schema.mcpAccounts.id, id))
    .limit(1)
  return account
}

export async function createMcpApiKeyAccount(input: McpApiKeyAccountCreateInput) {
  const validated = mcpApiKeyAccountCreateSchema.parse(input)
  const credentials = apiKeyCredentialsSchema.parse({ version: 1, apiKey: validated.apiKey })
  const now = Date.now()
  try {
    const [created] = await db
      .insert(schema.mcpAccounts)
      .values({
        id: createId('acc'),
        serverId: validated.serverId,
        label: validated.label,
        authType: 'api_key',
        credentialsJson: credentials,
        tokenExpiresAt: null,
        status: 'active',
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: schema.mcpAccounts.id })
    const account = await getMcpAccount(created.id)
    if (!account) throw new Error('Created MCP account could not be read')
    return account
  } catch {
    // Database errors can include bound parameters, including the credential.
    throw new Error('Could not create MCP account')
  }
}

export async function updateMcpAccount(id: string, patch: McpAccountUpdate) {
  const validated = mcpAccountUpdateSchema.parse(patch)
  try {
    const [updated] = await db
      .update(schema.mcpAccounts)
      .set({
        ...(validated.label !== undefined && { label: validated.label }),
        ...(validated.apiKey !== undefined && {
          credentialsJson: apiKeyCredentialsSchema.parse({
            version: 1,
            apiKey: validated.apiKey,
          }),
        }),
        updatedAt: Date.now(),
      })
      .where(and(eq(schema.mcpAccounts.id, id), eq(schema.mcpAccounts.authType, 'api_key')))
      .returning({ id: schema.mcpAccounts.id })
    return updated ? getMcpAccount(updated.id) : undefined
  } catch {
    throw new Error('Could not update MCP account')
  }
}

export async function deleteMcpAccount(id: string) {
  const deleted = await db
    .delete(schema.mcpAccounts)
    .where(eq(schema.mcpAccounts.id, id))
    .returning({ id: schema.mcpAccounts.id })
  return deleted.length > 0
}

export async function listAgentMcpAccounts(agentId: string): Promise<SafeMcpAccount[]> {
  return db
    .select(safeAccountSelection)
    .from(schema.agentMcpAccounts)
    .innerJoin(schema.mcpAccounts, eq(schema.agentMcpAccounts.accountId, schema.mcpAccounts.id))
    .where(eq(schema.agentMcpAccounts.agentId, agentId))
    .orderBy(asc(schema.agentMcpAccounts.enabledAt), asc(schema.mcpAccounts.id))
}

export function listMcpGrants() {
  return db
    .select()
    .from(schema.agentMcpAccounts)
    .orderBy(asc(schema.agentMcpAccounts.enabledAt), asc(schema.agentMcpAccounts.agentId))
}

export async function setAgentMcpAccounts(agentId: string, accountIds: string[]) {
  if (new Set(accountIds).size !== accountIds.length) {
    throw new Error('MCP account grants contain a duplicate account')
  }
  return db.transaction(async (tx) => {
    const [agent] = await tx
      .select({ id: schema.agents.id })
      .from(schema.agents)
      .where(eq(schema.agents.id, agentId))
      .limit(1)
    if (!agent) throw new Error(`Agent ${agentId} not found`)

    if (accountIds.length > 0) {
      const found = await tx
        .select({ id: schema.mcpAccounts.id })
        .from(schema.mcpAccounts)
        .where(inArray(schema.mcpAccounts.id, accountIds))
      const known = new Set(found.map((account) => account.id))
      const missing = accountIds.filter((id) => !known.has(id))
      if (missing.length > 0) throw new Error(`Unknown MCP accounts: ${missing.join(', ')}`)
    }

    await tx
      .delete(schema.agentMcpAccounts)
      .where(eq(schema.agentMcpAccounts.agentId, agentId))
    if (accountIds.length > 0) {
      const enabledAt = Date.now()
      await tx.insert(schema.agentMcpAccounts).values(
        accountIds.map((accountId) => ({ agentId, accountId, enabledAt })),
      )
    }
  }).then(() => listAgentMcpAccounts(agentId))
}

export async function listRuntimeMcpAccountsForAgent(
  agentId: string,
): Promise<RuntimeMcpAccount[]> {
  const rows = await db
    .select({
      accountId: schema.mcpAccounts.id,
      accountLabel: schema.mcpAccounts.label,
      authType: schema.mcpAccounts.authType,
      credentialsJson: schema.mcpAccounts.credentialsJson,
      serverId: schema.mcpServers.id,
      serverKey: schema.mcpServers.serverKey,
      serverName: schema.mcpServers.name,
      transport: schema.mcpServers.transport,
      configurationJson: schema.mcpServers.configurationJson,
    })
    .from(schema.agentMcpAccounts)
    .innerJoin(schema.mcpAccounts, eq(schema.agentMcpAccounts.accountId, schema.mcpAccounts.id))
    .innerJoin(schema.mcpServers, eq(schema.mcpAccounts.serverId, schema.mcpServers.id))
    .where(
      and(
        eq(schema.agentMcpAccounts.agentId, agentId),
        eq(schema.mcpServers.enabled, true),
        eq(schema.mcpAccounts.status, 'active'),
        eq(schema.mcpAccounts.authType, 'api_key'),
      ),
    )
    .orderBy(asc(schema.agentMcpAccounts.enabledAt), asc(schema.mcpAccounts.id))

  return rows.map((row) => ({
    accountId: row.accountId,
    accountLabel: row.accountLabel,
    serverId: row.serverId,
    serverKey: row.serverKey,
    serverName: row.serverName,
    transport: mcpTransportSchema.parse(row.transport),
    configuration: mcpStreamableHttpConfigurationSchema.parse(row.configurationJson),
    credentials: apiKeyCredentialsSchema.parse(row.credentialsJson),
  }))
}
