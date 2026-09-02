import { createHash } from 'node:crypto'
import {
  grantAgentMcpAccount,
  listMcpAccounts,
  listMcpServers,
  type ModelToolCall,
  type SendMessagePayload,
  type ToolDefinition,
  type WaitingState,
} from '@openbot/db'
import { MCP_CATALOG, type McpCatalogEntry, matchesMcpCatalogEntry } from './mcp-catalog'
import { installCatalogServer } from './handlers'

type PluginApproval = {
  pluginId: string
  valuesHash: string
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
          values: {
            type: 'object',
            description: 'Setup field values documented by GetPlugin.',
            additionalProperties: { type: 'string' },
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

async function installedServer(entry: McpCatalogEntry) {
  return (await listMcpServers()).find((server) => matchesMcpCatalogEntry(entry, server))
}

async function renderPlugin(entry: McpCatalogEntry) {
  const server = await installedServer(entry)
  const accounts = server ? await listMcpAccounts(server.id) : []
  const lines = [
    `${entry.key}: ${entry.name} — ${entry.description}`,
    `installed=${server ? 'yes' : 'no'} · includes: ${includes(entry)} · category=connector`,
  ]

  if (entry.skills.length > 0) {
    lines.push('', 'Skills:')
    for (const skill of entry.skills) lines.push(`  - ${skill} — ${entry.name} connector capability.`)
  }

  if (server) {
    lines.push('', 'Setup fields (pass in InstallPlugin values):')
    if (accounts.length > 0) {
      lines.push('  - account_id (Existing account ID; optional)')
    } else {
      lines.push('  - No agent-safe setup values. Connect credentials in the Plugins UI.')
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
        lines.push(
          `  - ${server.id}: ${server.name} [${account.status}] · account=${account.label} (${account.id}) · transport=${server.transport} · tools=available after grant`,
        )
      }
    }
  }

  return lines.join('\n')
}

async function installForAgent(
  agentId: string,
  entry: McpCatalogEntry,
  values: Record<string, string>,
) {
  const server = await installCatalogServer({ key: entry.key })
  const accountId = values.account_id

  const accounts = await listMcpAccounts(server.id)
  if (accountId && !accounts.some((account) => account.id === accountId)) {
    throw new Error(`MCP account ${accountId} does not belong to ${entry.name}`)
  }

  if (accountId) {
    await grantAgentMcpAccount(agentId, accountId)
  }

  const authMessage = accountId
    ? 'The connector account was granted. New MCP tools become available on the next message.'
    : `Connect an account for ${entry.name} in Plugins, then grant it to this agent. New MCP tools become available on the following message.`
  return [
    `Installed ${entry.name} (plugin ${entry.key}).`,
    authMessage,
    await renderPlugin(entry),
  ].join('\n')
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
          !normalized || `${entry.key}\n${entry.name}\n${entry.description}\n${entry.skills.join('\n')}`
            .toLowerCase()
            .includes(normalized),
        )
        if (matches.length === 0) return `No plugins match "${query}".`
        const installed = await listMcpServers()
        return [
          `${matches.length} plugin(s)${query ? ` matching "${query}"` : ''}:`,
          ...matches.flatMap((entry) => [
            `- ${entry.key}: ${entry.name} — ${entry.description}`,
            `  (installed=${installed.some((server) => matchesMcpCatalogEntry(entry, server)) ? 'yes' : 'no'}; includes: ${includes(entry)}; category=connector)`,
          ]),
        ].join('\n')
      }

      const pluginId = typeof input.plugin_id === 'string' ? input.plugin_id : ''
      const entry = MCP_CATALOG.find((candidate) => candidate.key === pluginId)
      if (!entry) return `Unknown plugin: ${pluginId || '(missing plugin_id)'}.`
      if (call.function.name === 'GetPlugin') return renderPlugin(entry)

      if (call.function.name === 'InstallPlugin') {
        if (
          input.values !== undefined &&
          (!input.values || typeof input.values !== 'object' || Array.isArray(input.values))
        ) return 'InstallPlugin values must be an object of strings.'
        const valueEntries = Object.entries(input.values ?? {})
        if (valueEntries.some(([, value]) => typeof value !== 'string')) {
          return 'InstallPlugin values must be an object of strings.'
        }
        const values = Object.fromEntries(valueEntries) as Record<string, string>
        const unsupported = Object.keys(values).filter((key) => key !== 'account_id')
        if (unsupported.length > 0) {
          return `Unsupported InstallPlugin setup fields: ${unsupported.join(', ')}. Enter credentials in the Plugins UI.`
        }
        const server = await installedServer(entry)
        const accounts = server ? await listMcpAccounts(server.id) : []
        const selected = values.account_id
          ? accounts.find((account) => account.id === values.account_id)
          : undefined
        if (values.account_id && !selected) {
          return `MCP account ${values.account_id} does not belong to ${entry.name}.`
        }
        if (values.account_id && selected?.status !== 'active') {
          return `MCP account ${selected?.label ?? values.account_id} is not active.`
        }
        const valuesHash = stableValuesHash(values)
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
          const action = selected
            ? `install ${entry.name} and grant its "${selected.label}" account to this agent`
            : `install ${entry.name}; connecting and granting an account will still be required in Plugins`
          const prompt = `Allow OpenBot to ${action}?`
          const options = [
            { id: 'approve', label: `Approve ${entry.name}`, style: 'primary' as const },
            { id: 'deny', label: 'Deny' },
          ]
          await context.suspend(
            {
              version: 1,
              interactionKind: 'approval',
              prompt,
              options,
              allowCustom: false,
              dismissOnMoveOn: false,
              originatingToolCall: { id: call.id, name: call.function.name },
              resumeData: { version: 1, pluginId: entry.key, valuesHash },
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
                },
              },
            },
          )
          return `Waiting for the user to approve ${entry.name}.`
        }
        approval = undefined
        return installForAgent(agentId, entry, values)
      }

      return `Unknown plugin management tool: ${call.function.name}.`
    },
  }
}
