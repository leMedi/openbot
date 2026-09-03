import {
  siAirtable,
  siAsana,
  siAtlassian,
  siBox,
  siBuildkite,
  siClickup,
  siCloudflareworkers,
  siEgnyte,
  siGithub,
  siIntercom,
  siLinear,
  siNeon,
  siNetlify,
  siNotion,
  siPaypal,
  siSentry,
  siSquare,
  siStripe,
  siSupabase,
  siVercel,
  siWebflow,
  siWix,
} from 'simple-icons'
import { siAttio, siCanva, siClose, siMonday, siRamp } from './vendored-icons'

export type McpCatalogOauthAuth = {
  type: 'oauth'
}

export type McpCatalogApiKeyAuth = {
  type: 'apiKey'
  header: string
  prefix: 'Bearer' | ''
}

export type McpCatalogAuth = McpCatalogOauthAuth | McpCatalogApiKeyAuth

export type McpCatalogEntry = {
  key: string
  name: string
  description: string
  searchTerms?: readonly string[]
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
    searchTerms: ['tickets', 'issue tracker', 'project management'],
    auth: [
      { type: 'oauth' },
      { type: 'apiKey', header: 'Authorization', prefix: 'Bearer' },
    ],
    url: 'https://mcp.linear.app/mcp',
    icon: { path: siLinear.path, color: `#${siLinear.hex}` },
    skills: ['Search issues', 'Create and update issues', 'Manage projects', 'Add comments'],
  },
  {
    key: 'clickup',
    name: 'ClickUp',
    description: 'Work with tasks, docs, chat, and time tracking across your workspace.',
    searchTerms: ['tickets', 'issues', 'issue tracker', 'project management'],
    auth: [{ type: 'oauth' }],
    url: 'https://mcp.clickup.com/mcp',
    icon: { path: siClickup.path, color: `#${siClickup.hex}` },
    skills: ['Search the workspace', 'Manage tasks', 'Read docs and chat', 'Track time'],
  },
  {
    key: 'notion',
    name: 'Notion',
    description: 'Search, read, and update knowledge in your Notion workspace.',
    auth: [{ type: 'oauth' }],
    url: 'https://mcp.notion.com/mcp',
    icon: { path: siNotion.path, color: `#${siNotion.hex}` },
    skills: ['Search workspace content', 'Read and update pages', 'Manage databases', 'Add comments'],
  },
  {
    key: 'asana',
    name: 'Asana',
    description: 'Track team projects, tasks, and goals in Asana.',
    searchTerms: ['tickets', 'issue tracker', 'project management'],
    auth: [{ type: 'oauth' }],
    url: 'https://mcp.asana.com/sse',
    icon: { path: siAsana.path, color: `#${siAsana.hex}` },
    skills: ['Search tasks and projects', 'Create and update tasks', 'Manage projects', 'Add comments'],
  },
  {
    key: 'monday',
    name: 'monday.com',
    description: 'Run boards, items, and workflows across your monday.com workspace.',
    searchTerms: ['tickets', 'issues', 'project management'],
    auth: [{ type: 'oauth' }],
    url: 'https://mcp.monday.com/sse',
    icon: { path: siMonday.path, color: `#${siMonday.hex}` },
    skills: ['Search boards', 'Create and update items', 'Manage boards and groups', 'Post updates'],
  },
  {
    key: 'atlassian',
    name: 'Atlassian',
    description: 'Work with Jira issues and Confluence pages across your Atlassian sites.',
    searchTerms: ['tickets', 'issue tracker', 'project management'],
    auth: [{ type: 'oauth' }],
    url: 'https://mcp.atlassian.com/v1/sse',
    icon: { path: siAtlassian.path, color: `#${siAtlassian.hex}` },
    skills: ['Search Jira issues', 'Create and update issues', 'Read and edit Confluence pages', 'Add comments'],
  },
  {
    key: 'airtable',
    name: 'Airtable',
    description: 'Query and update records in your Airtable bases.',
    auth: [{ type: 'oauth' }],
    url: 'https://mcp.airtable.com/mcp',
    icon: { path: siAirtable.path, color: `#${siAirtable.hex}` },
    skills: ['List bases and tables', 'Search records', 'Create and update records', 'Manage table schemas'],
  },
  {
    key: 'box',
    name: 'Box',
    description: 'Search, read, and organize files in your Box account.',
    auth: [{ type: 'oauth' }],
    url: 'https://mcp.box.com',
    icon: { path: siBox.path, color: `#${siBox.hex}` },
    skills: ['Search files and folders', 'Read file contents', 'Upload and organize files', 'Share links'],
  },
  {
    key: 'egnyte',
    name: 'Egnyte',
    description: 'Find and work with documents stored in Egnyte.',
    auth: [{ type: 'oauth' }],
    url: 'https://mcp-server.egnyte.com/sse',
    icon: { path: siEgnyte.path, color: `#${siEgnyte.hex}` },
    skills: ['Search content', 'Read documents', 'Manage files and folders', 'Share links'],
  },
  {
    key: 'attio',
    name: 'Attio',
    description: 'Manage companies, people, and deals in your Attio CRM.',
    auth: [{ type: 'oauth' }],
    url: 'https://mcp.attio.com/mcp',
    icon: { path: siAttio.path, color: `#${siAttio.hex}` },
    skills: ['Search records', 'Create and update records', 'Manage lists', 'Add notes'],
  },
  {
    key: 'close',
    name: 'Close',
    description: 'Work leads, contacts, and sales activity in Close.',
    auth: [{ type: 'oauth' }],
    url: 'https://mcp.close.com/mcp',
    icon: { path: siClose.path, color: `#${siClose.hex}` },
    skills: ['Search leads and contacts', 'Create and update leads', 'Log calls and emails', 'Manage opportunities'],
  },
  {
    key: 'intercom',
    name: 'Intercom',
    description: 'Look up customers and conversations in Intercom.',
    auth: [{ type: 'oauth' }],
    url: 'https://mcp.intercom.com/sse',
    icon: { path: siIntercom.path, color: `#${siIntercom.hex}` },
    skills: ['Search conversations', 'Read customer profiles', 'Manage tickets', 'Reply to conversations'],
  },
  {
    key: 'canva',
    name: 'Canva',
    description: 'Create and manage designs in your Canva workspace.',
    auth: [{ type: 'oauth' }],
    url: 'https://mcp.canva.com/mcp',
    icon: { path: siCanva.path, color: `#${siCanva.hex}` },
    skills: ['Search designs', 'Create designs', 'Export designs', 'Manage folders'],
  },
  {
    key: 'webflow',
    name: 'Webflow',
    description: 'Manage sites, pages, and CMS content in Webflow.',
    auth: [{ type: 'oauth' }],
    url: 'https://mcp.webflow.com/sse',
    icon: { path: siWebflow.path, color: `#${siWebflow.hex}` },
    skills: ['List sites and pages', 'Update CMS items', 'Manage collections', 'Publish changes'],
  },
  {
    key: 'wix',
    name: 'Wix',
    description: 'Manage your Wix site content and business data.',
    auth: [{ type: 'oauth' }],
    url: 'https://mcp.wix.com/sse',
    icon: { path: siWix.path, color: `#${siWix.hex}` },
    skills: ['Read site content', 'Update pages and content', 'Manage products and orders', 'Handle bookings'],
  },
  {
    key: 'github',
    name: 'GitHub',
    description: 'Work with repositories, issues, and pull requests on GitHub.',
    searchTerms: ['tickets', 'issue tracker', 'project management'],
    auth: [{ type: 'oauth' }],
    url: 'https://api.githubcopilot.com/mcp',
    icon: { path: siGithub.path, color: `#${siGithub.hex}` },
    skills: ['Search code and repos', 'Manage issues', 'Review pull requests', 'Read file contents'],
  },
  {
    key: 'sentry',
    name: 'Sentry',
    description: 'Investigate errors and performance issues tracked in Sentry.',
    auth: [{ type: 'oauth' }],
    url: 'https://mcp.sentry.dev/sse',
    icon: { path: siSentry.path, color: `#${siSentry.hex}` },
    skills: ['Search issues and errors', 'Read stack traces', 'Manage alerts', 'Track releases'],
  },
  {
    key: 'vercel',
    name: 'Vercel',
    description: 'Inspect deployments and projects in Vercel.',
    auth: [{ type: 'oauth' }],
    url: 'https://mcp.vercel.com/',
    icon: { path: siVercel.path, color: `#${siVercel.hex}` },
    skills: ['List projects and deployments', 'Read build logs', 'Manage environment variables', 'Search docs'],
  },
  {
    key: 'netlify',
    name: 'Netlify',
    description: 'Manage sites, deploys, and configuration on Netlify.',
    auth: [{ type: 'oauth' }],
    url: 'https://netlify-mcp.netlify.app/mcp',
    icon: { path: siNetlify.path, color: `#${siNetlify.hex}` },
    skills: ['List sites', 'Read deploy status and logs', 'Manage environment variables', 'Trigger deploys'],
  },
  {
    key: 'supabase',
    name: 'Supabase',
    description: 'Query and manage your Supabase projects and databases.',
    auth: [{ type: 'oauth' }],
    url: 'https://mcp.supabase.com/mcp',
    icon: { path: siSupabase.path, color: `#${siSupabase.hex}` },
    skills: ['Run SQL queries', 'Inspect schemas', 'Manage projects', 'Read logs'],
  },
  {
    key: 'neon',
    name: 'Neon',
    description: 'Manage Neon Postgres projects, branches, and databases.',
    auth: [{ type: 'oauth' }],
    url: 'https://mcp.neon.tech/mcp',
    icon: { path: siNeon.path, color: `#${siNeon.hex}` },
    skills: ['Run SQL queries', 'Manage branches', 'Inspect schemas', 'Manage projects'],
  },
  {
    key: 'buildkite',
    name: 'Buildkite',
    description: 'Inspect pipelines and builds running on Buildkite.',
    auth: [{ type: 'oauth' }],
    url: 'https://mcp.buildkite.com/mcp',
    icon: { path: siBuildkite.path, color: `#${siBuildkite.hex}` },
    skills: ['List pipelines', 'Read build status and logs', 'Trigger builds', 'Manage jobs'],
  },
  {
    key: 'cloudflare-workers',
    name: 'Cloudflare Workers',
    description: 'Build and inspect Cloudflare Workers and their bindings.',
    auth: [{ type: 'oauth' }],
    url: 'https://bindings.mcp.cloudflare.com/sse',
    icon: { path: siCloudflareworkers.path, color: `#${siCloudflareworkers.hex}` },
    skills: ['Manage Workers', 'Query KV and R2', 'Inspect D1 databases', 'Read bindings'],
  },
  {
    key: 'stripe',
    name: 'Stripe',
    description: 'Work with customers, payments, and subscriptions in Stripe.',
    auth: [{ type: 'oauth' }],
    url: 'https://mcp.stripe.com/',
    icon: { path: siStripe.path, color: `#${siStripe.hex}` },
    skills: ['Search customers', 'Manage payments and refunds', 'Handle subscriptions', 'Create invoices'],
  },
  {
    key: 'paypal',
    name: 'PayPal',
    description: 'Manage payments, orders, and invoices with PayPal.',
    auth: [{ type: 'oauth' }],
    url: 'https://mcp.paypal.com/sse',
    icon: { path: siPaypal.path, color: `#${siPaypal.hex}` },
    skills: ['Create and track orders', 'Manage invoices', 'Process refunds', 'Read transactions'],
  },
  {
    key: 'square',
    name: 'Square',
    description: 'Manage payments, catalog, and customers across Square.',
    auth: [{ type: 'oauth' }],
    url: 'https://mcp.squareup.com/sse',
    icon: { path: siSquare.path, color: `#${siSquare.hex}` },
    skills: ['Read payments and orders', 'Manage catalog items', 'Look up customers', 'Track inventory'],
  },
  {
    key: 'ramp',
    name: 'Ramp',
    description: 'Review spend, cards, and transactions in Ramp.',
    auth: [{ type: 'oauth' }],
    url: 'https://ramp-mcp-remote.ramp.com/mcp',
    icon: { path: siRamp.path, color: `#${siRamp.hex}` },
    skills: ['Search transactions', 'Manage cards', 'Review spend limits', 'Read receipts and memos'],
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
