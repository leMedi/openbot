import { createHash } from 'node:crypto'
import {
  grantAgentMcpAccount,
  listAgentMcpAccounts,
  listMcpAccounts,
  listMcpServers,
  type ModelToolCall,
  type SendMessagePayload,
  type ToolDefinition,
  type WaitingState,
} from '@openbot/db'
import { MCP_CATALOG, type McpCatalogEntry, matchesMcpCatalogEntry } from './mcp-catalog'
import { installCatalogServer } from './handlers'

export type PluginApproval = {
  pluginId: string
  valuesHash: string
  accountIds: string[]
  approved: boolean
}

export type McpManagementContext = {
  approval?: PluginApproval
  suspend: (
    state: WaitingState,
    delivery: { bodyText: string; payload: SendMessagePayload },
  ) => Promise<unknown>
}

export type McpManagementTools = {
  definitions: ToolDefinition[]
  execute(call: ModelToolCall): Promise<string>
}

const definitions: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'SearchPlugins',
      description: 'Search the catalog of plugins that can be installed for this agent.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Optional case-insensitive catalog search.' },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'GetPlugin',
      description: 'Show capabilities, setup fields, and installation details for a plugin.',
      parameters: {
        type: 'object',
        properties: {
          plugin_id: { type: 'string', description: 'Stable ID returned by SearchPlugins.' },
        },
        required: ['plugin_id'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'InstallPlugin',
      description:
        'Request user approval, then install a catalog plugin for this agent. Repeat the exact call after approval.',
      parameters: {
        type: 'object',
        properties: {
          plugin_id: { type: 'string', description: 'Stable ID returned by SearchPlugins.' },
          account_ids: {
            type: 'array',
            description:
              'Account IDs to grant. Optional with zero or one active account; required with multiple active accounts.',
            items: { type: 'string' },
            uniqueItems: true,
          },
        },
        required: ['plugin_id'],
        additionalProperties: false,
      },
    },
  },
]

function stableValuesHash(values: Record<string, string>) {
  return createHash('sha256')
    .update(JSON.stringify(Object.fromEntries(Object.entries(values).sort(([a], [b]) => a.localeCompare(b)))))
    .digest('hex')
}

function includes(entry: McpCatalogEntry) {
  return `MCP connector; ${entry.skills.length} skills`
}

function searchableText(entry: McpCatalogEntry) {
  return [entry.key, entry.name, entry.description, ...entry.skills, ...(entry.searchTerms ?? [])]
    .join('\n')
    .toLowerCase()
}

async function installedServer(entry: McpCatalogEntry) {
  return (await listMcpServers()).find((server) => matchesMcpCatalogEntry(entry, server))
}

async function renderPlugin(agentId: string, entry: McpCatalogEntry) {
  const server = await installedServer(entry)
  const accounts = server ? await listMcpAccounts(server.id) : []
  const grantedIds = new Set((await listAgentMcpAccounts(agentId)).map((account) => account.id))
  const lines = [
    `${entry.key}: ${entry.name} — ${entry.description}`,
    `server installed=${server ? 'yes' : 'no'} · connected accounts=${accounts.length} · granted to this agent=${accounts.filter((account) => grantedIds.has(account.id)).length} · includes: ${includes(entry)} · category=connector`,
  ]

  if (entry.skills.length > 0) {
    lines.push('', 'Skills:')
    for (const skill of entry.skills) lines.push(`  - ${skill} — ${entry.name} connector capability.`)
  }

  if (server) {
    const activeAccounts = accounts.filter((account) => account.status === 'active')
    lines.push('', 'Account selection (pass as InstallPlugin account_ids):')
    if (activeAccounts.length === 1) {
      lines.push(
        `  - Optional; omission selects ${activeAccounts[0].label} (${activeAccounts[0].id}).`,
      )
    } else if (activeAccounts.length > 1) {
      lines.push('  - Required; select one or more active account IDs:')
      for (const account of activeAccounts) lines.push(`    - ${account.label} (${account.id})`)
    } else {
      lines.push('  - No active accounts. Connect credentials in the Plugins UI.')
    }
  }

  if (server) {
    lines.push('', 'Its installed MCP server(s):')
    if (accounts.length === 0) {
      lines.push(
        `  - ${server.id}: ${server.name} [${server.enabled ? 'needs-account' : 'disabled'}] · transport=${server.transport} · tools=available after connection`,
      )
    } else {
      for (const account of accounts) {
        const granted = grantedIds.has(account.id)
        lines.push(
          `  - ${server.id}: ${server.name} [${account.status}] · account=${account.label} (${account.id}) · agent access=${granted ? 'granted' : 'not granted'} · transport=${server.transport} · tools=${granted ? 'granted to this agent' : 'available after grant'}`,
        )
      }
    }
  }

  return lines.join('\n')
}

async function installForAgent(
  agentId: string,
  entry: McpCatalogEntry,
  accountIds: string[],
) {
  const server = await installCatalogServer({ key: entry.key })
  const accounts = await listMcpAccounts(server.id)
  for (const accountId of accountIds) {
    const account = accounts.find((candidate) => candidate.id === accountId)
    if (!account) {
      throw new Error(`MCP account ${accountId} does not belong to ${entry.name}`)
    }
    if (account.status !== 'active') {
      throw new Error(`MCP account ${account.label} is not active`)
    }
    await grantAgentMcpAccount(agentId, accountId)
  }

  const authMessage = accountIds.length > 0
    ? `${accountIds.length === 1 ? 'The connector account was' : 'The connector accounts were'} granted.`
    : `Connect an account for ${entry.name} in Plugins, then grant it to this agent. New MCP tools become available on the following message.`
  return [
    accountIds.length > 0
      ? `Enabled ${entry.name} (plugin ${entry.key}) for this agent.`
      : `Installed ${entry.name} (plugin ${entry.key}).`,
    authMessage,
    await renderPlugin(agentId, entry),
  ].join('\n')
}

/** Applies the exact account selection authorized by a durable approval response. */
export async function applyApprovedPlugin(
  agentId: string,
  approval: PluginApproval,
) {
  if (!approval.approved) return undefined
  const entry = MCP_CATALOG.find((candidate) => candidate.key === approval.pluginId)
  if (!entry) throw new Error(`Unknown approved plugin: ${approval.pluginId}`)
  const accountIds = [...approval.accountIds].sort()
  if (new Set(accountIds).size !== accountIds.length) {
    throw new Error('Approved plugin accounts contain duplicates')
  }
  if (stableValuesHash({ account_ids: accountIds.join('\0') }) !== approval.valuesHash) {
    throw new Error('Approved plugin account selection does not match the approval')
  }
  return installForAgent(agentId, entry, accountIds)
}

export function createMcpManagementTools(
  agentId: string,
  context: McpManagementContext,
): McpManagementTools {
  let approval = context.approval
  return {
    definitions,
    async execute(call) {
      let parsed: unknown
      try {
        parsed = JSON.parse(call.function.arguments || '{}')
      } catch {
        return 'Tool arguments must be valid JSON.'
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return 'Tool arguments must be an object.'
      }
      const input = parsed as Record<string, unknown>

      if (call.function.name === 'SearchPlugins') {
        if (input.query !== undefined && typeof input.query !== 'string') {
          return 'SearchPlugins query must be a string.'
        }
        const query = typeof input.query === 'string' ? input.query.trim() : ''
        const normalized = query.toLowerCase()
        const matches = MCP_CATALOG.filter((entry) =>
          !normalized || searchableText(entry).includes(normalized),
        )
        if (matches.length === 0) return `No plugins match "${query}".`
        const installed = await listMcpServers()
        const grantedIds = new Set(
          (await listAgentMcpAccounts(agentId)).map((account) => account.id),
        )
        const statuses = await Promise.all(matches.map(async (entry) => {
          const server = installed.find((candidate) => matchesMcpCatalogEntry(entry, candidate))
          const accounts = server ? await listMcpAccounts(server.id) : []
          return {
            entry,
            server,
            connected: accounts.length,
            granted: accounts.filter((account) => grantedIds.has(account.id)).length,
          }
        }))
        return [
          `${matches.length} plugin(s)${query ? ` matching "${query}"` : ''}:`,
          ...statuses.flatMap(({ entry, server, connected, granted }) => [
            `- ${entry.key}: ${entry.name} — ${entry.description}`,
            `  (server installed=${server ? 'yes' : 'no'}; connected accounts=${connected}; granted to this agent=${granted}; includes: ${includes(entry)}; category=connector)`,
          ]),
        ].join('\n')
      }

      const pluginId = typeof input.plugin_id === 'string' ? input.plugin_id : ''
      const entry = MCP_CATALOG.find((candidate) => candidate.key === pluginId)
      if (!entry) return `Unknown plugin: ${pluginId || '(missing plugin_id)'}.`
      if (call.function.name === 'GetPlugin') return renderPlugin(agentId, entry)

      if (call.function.name === 'InstallPlugin') {
        if (
          input.account_ids !== undefined &&
          (!Array.isArray(input.account_ids) || input.account_ids.some((id) => typeof id !== 'string'))
        ) {
          return 'InstallPlugin account_ids must be an array of account ID strings.'
        }
        const requestedIds = (input.account_ids ?? []) as string[]
        if (new Set(requestedIds).size !== requestedIds.length) {
          return 'InstallPlugin account_ids cannot contain duplicates.'
        }
        const server = await installedServer(entry)
        const accounts = server ? await listMcpAccounts(server.id) : []
        const activeAccounts = accounts.filter((account) => account.status === 'active')
        if (requestedIds.length === 0 && activeAccounts.length > 1) {
          return [
            `${entry.name} has multiple active accounts. Repeat InstallPlugin with one or more account_ids:`,
            ...activeAccounts.map((account) => `- ${account.label}: ${account.id}`),
          ].join('\n')
        }
        const selected = requestedIds.length > 0
          ? requestedIds.map((id) => accounts.find((account) => account.id === id))
          : activeAccounts.length === 1
            ? [activeAccounts[0]]
            : []
        const missingId = requestedIds.find((id) => !accounts.some((account) => account.id === id))
        if (missingId) return `MCP account ${missingId} does not belong to ${entry.name}.`
        const inactive = selected.find((account) => account?.status !== 'active')
        if (inactive) {
          return `MCP account ${inactive.label} is not active.`
        }
        const accountIds = selected.map((account) => account!.id).sort()
        const valuesHash = stableValuesHash({ account_ids: accountIds.join('\0') })
        if (
          approval &&
          approval.pluginId === entry.key &&
          approval.valuesHash === valuesHash &&
          !approval.approved
        ) {
          approval = undefined
          return `Installation of ${entry.name} was not approved.`
        }
        if (
          !approval ||
          !approval.approved ||
          approval.pluginId !== entry.key ||
          approval.valuesHash !== valuesHash
        ) {
          const action = selected.length > 0
            ? `grant ${selected.length === 1 ? `${entry.name}'s "${selected[0]!.label}" account` : `${selected.length} selected ${entry.name} accounts`} to this agent`
            : `install ${entry.name}; connecting and granting an account will still be required in Plugins`
          const prompt = `Allow OpenBot to ${action}?`
          const options = [
            {
              id: 'approve',
              label: selected.length > 0 ? `Enable ${entry.name}` : `Install ${entry.name}`,
              style: 'primary' as const,
            },
            { id: 'deny', label: 'Not now' },
          ]
          const plugin = { key: entry.key, name: entry.name }
          await context.suspend(
            {
              version: 1,
              interactionKind: 'approval',
              prompt,
              options,
              allowCustom: false,
              dismissOnMoveOn: false,
              plugin,
              originatingToolCall: { id: call.id, name: call.function.name },
              resumeData: { version: 1, pluginId: entry.key, valuesHash, accountIds },
              response: null,
            },
            {
              bodyText: prompt,
              payload: {
                version: 1,
                deliveryKind: 'send-message',
                type: 'widget',
                toolCallId: call.id,
                widget: {
                  prompt,
                  interactionKind: 'approval',
                  options,
                  allowCustom: false,
                  dismissOnMoveOn: false,
                  plugin,
                },
              },
            },
          )
          return `Waiting for the user to approve ${entry.name}.`
        }
        approval = undefined
        return installForAgent(agentId, entry, accountIds)
      }

      return `Unknown plugin management tool: ${call.function.name}.`
    },
  }
}
