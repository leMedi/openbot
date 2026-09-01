import * as z from 'zod'

const streamableHttpConfiguration = z
  .object({
    version: z.literal(1),
    url: z.url(),
    apiKeyHeader: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .regex(/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/),
    apiKeyPrefix: z.enum(['Bearer', '']),
  })
  .strict()

export const mcpServerCreateInput = z.object({
  serverKey: z.string().trim().min(1).max(100),
  name: z.string().trim().min(1).max(200),
  transport: z.literal('streamable_http'),
  configuration: streamableHttpConfiguration,
  enabled: z.boolean().optional(),
})

export const mcpServerUpdateInput = z.object({
  id: z.string().min(1),
  patch: z
    .object({
      serverKey: z.string().trim().min(1).max(100).optional(),
      name: z.string().trim().min(1).max(200).optional(),
      transport: z.literal('streamable_http').optional(),
      configuration: streamableHttpConfiguration.optional(),
      enabled: z.boolean().optional(),
    })
    .refine((patch) => Object.keys(patch).length > 0),
})

export const mcpIdInput = z.object({ id: z.string().min(1) })

export const mcpApiKeyAccountCreateInput = z.object({
  serverId: z.string().min(1),
  label: z.string().trim().min(1).max(200),
  apiKey: z
    .string()
    .min(1)
    .max(20_000)
    .refine((value) => !/[\0\r\n]/.test(value), 'API key contains invalid characters'),
})

export const mcpAccountUpdateInput = z.object({
  id: z.string().min(1),
  patch: z
    .object({
      label: z.string().trim().min(1).max(200).optional(),
      apiKey: z.string().min(1).max(20_000).optional(),
    })
    .refine((patch) => Object.keys(patch).length > 0),
})

export const agentMcpAccountsInput = z.object({
  agentId: z.string().min(1),
  accountIds: z.array(z.string().min(1)),
})
