// Mock data mirroring the "OpenBot v6" design canvas. UI-only — no persistence.

export type MessageItem = { key: string; val: string }

export type Permission = {
  plugin: string
  account: string
  action: string
  preview: string
  status: 'pending' | 'approved' | 'denied'
}

export type AccessRequest = {
  plugin: string
  account: string
  status: 'pending' | 'granted' | 'denied'
}

export type Choice = {
  status: 'pending' | 'resolved'
  multi: boolean
  options: { id: string; label: string; hint?: string }[]
}

export type Remote = {
  machine: string
  url: string
  blocker: string
  status: 'stuck' | 'resolved'
}

export type Delegation = {
  to: string
  toName: string
  status: 'working' | 'done'
  duration?: string
}

export type Message = {
  id: string
  role: 'user' | 'bot'
  text: string
  time: string
  routine?: string
  title?: string
  items?: MessageItem[]
  permission?: Permission
  access?: AccessRequest
  choice?: Choice
  remote?: Remote
  delegation?: Delegation
  thread?: Message[]
}

export type Bot = {
  id: string
  name: string
  color: string
  /** Avatar shape id (see AVATAR_SHAPES). */
  shape: string
  model: string
  prompt: string
  grants: [pluginId: string, accountId: string][]
  memory: string
  avatarUrl?: string
}

export type Conversation = {
  id: string
  botId: string
  title: string
  time: string
  unread?: boolean
  pinned?: boolean
  messages: Message[]
}

export type PluginAccount = { id: string; name: string; status: string }

export type Plugin = {
  id: string
  name: string
  cat: string
  hue: string
  blurb: string
  installed: boolean
  tools: number
  connectors: number
  bundled: string[]
  accounts: PluginAccount[]
}

export type Skill = {
  id: string
  name: string
  source: 'link' | 'manual'
  origin: string
  enabled: boolean
  desc: string
  md: string
}

export type Provider = {
  id: string
  name: string
  hue: string
  connected: boolean
  tag: string
  auth: 'key' | 'oauth'
  badge?: string
  desc: string
}

export const BOT_COLORS = [
  '#5865c4',
  '#b0783a',
  '#5f9e63',
  '#b3536e',
  '#8a5fc4',
  '#3f8f8a',
]

export const AVATAR_COLORS = [
  '#f2f2f2',
  '#b0783a',
  '#b3536e',
  '#c46b4a',
  '#5f9e63',
  '#3f8f8a',
  '#5865c4',
  '#8a5fc4',
  '#9a9aa0',
]

export const AVATAR_SHAPES = [
  { id: 'circle', d: 'M24 4a20 20 0 1 1 0 40a20 20 0 1 1 0-40Z' },
  { id: 'squircle', d: 'M24 5c13 0 19 6 19 19s-6 19-19 19S5 37 5 24 11 5 24 5Z' },
  { id: 'pill', d: 'M14 12h20a12 12 0 0 1 0 24H14a12 12 0 0 1 0-24Z' },
  {
    id: 'triangle',
    d: 'M20.5 8.2c1.6-2.7 5.4-2.7 7 0l14.8 25.6c1.6 2.7-.3 6.2-3.5 6.2H9.2c-3.2 0-5.1-3.5-3.5-6.2Z',
  },
  {
    id: 'hexagon',
    d: 'M21 4.7a6 6 0 0 1 6 0l12.3 7.1a6 6 0 0 1 3 5.2v14a6 6 0 0 1-3 5.2L27 43.3a6 6 0 0 1-6 0L8.7 36.2a6 6 0 0 1-3-5.2v-14a6 6 0 0 1 3-5.2Z',
  },
  {
    id: 'cloud',
    d: 'M13 40a9 9 0 0 1-2-17.8A12.5 12.5 0 0 1 35.3 19 8.5 8.5 0 0 1 35 40Z',
  },
  {
    id: 'drop',
    d: 'M24 4c9 10.4 16 18.6 16 26a16 16 0 0 1-32 0C8 22.6 15 12.4 24 4Z',
  },
]

export const MODEL_GROUPS = [
  {
    provider: 'Anthropic',
    hue: '#c4713f',
    models: ['Sonnet 4.5', 'Opus 4.6', 'Haiku 4.5'],
  },
  {
    provider: 'OpenAI',
    hue: '#4a9a8a',
    models: ['GPT-5.2', 'GPT-5.2 mini', 'o5'],
  },
]

export const PLUGINS: Plugin[] = [
  {
    id: 'clickup',
    name: 'ClickUp',
    cat: 'Tasks',
    hue: '#4c63e6',
    blurb: 'Read and write tasks, sprints and time entries on your workspace.',
    installed: true,
    tools: 58,
    connectors: 1,
    bundled: ['Sprint hygiene', 'Task field conventions'],
    accounts: [{ id: 'a1', name: 'default', status: 'connected' }],
  },
  {
    id: 'slack',
    name: 'Slack',
    cat: 'Comms',
    hue: '#8fbe5f',
    blurb: 'Post and read messages across channels the bot has been invited to.',
    installed: true,
    tools: 21,
    connectors: 2,
    bundled: ['Channel etiquette', 'Message formatting'],
    accounts: [
      { id: 'a2', name: 'work', status: 'connected' },
      { id: 'a3', name: 'community', status: 'connected' },
    ],
  },
  {
    id: 'linear',
    name: 'Linear',
    cat: 'Tasks',
    hue: '#8a5fc4',
    blurb: 'Issues, cycles and project state, with comment threads.',
    installed: false,
    tools: 30,
    connectors: 1,
    bundled: [],
    accounts: [],
  },
  {
    id: 'gmail',
    name: 'Mail',
    cat: 'Comms',
    hue: '#b0574f',
    blurb: 'Search threads, draft replies, and label inbound mail.',
    installed: true,
    tools: 12,
    connectors: 1,
    bundled: [],
    accounts: [{ id: 'a4', name: 'mehdi@work', status: 'connected' }],
  },
  {
    id: 'notion',
    name: 'Notion',
    cat: 'Docs',
    hue: '#98989d',
    blurb: 'Pages and databases — read specs, append meeting notes.',
    installed: false,
    tools: 26,
    connectors: 1,
    bundled: [],
    accounts: [],
  },
  {
    id: 'github',
    name: 'GitHub',
    cat: 'Dev',
    hue: '#4a4a4f',
    blurb: 'Repos, pull requests, reviews and check runs.',
    installed: true,
    tools: 44,
    connectors: 3,
    bundled: ['PR review flow', 'Release tagging'],
    accounts: [
      { id: 'a5', name: 'personal', status: 'connected' },
      { id: 'a6', name: 'org: startwillow', status: 'needs re-auth' },
    ],
  },
  {
    id: 'chrome',
    name: 'Browser',
    cat: 'Browser',
    hue: '#6b8fd4',
    blurb: 'Drive a real browser session — search, click, read pages.',
    installed: true,
    tools: 16,
    connectors: 1,
    bundled: ['Safe browsing rules'],
    accounts: [{ id: 'a7', name: 'default profile', status: 'connected' }],
  },
  {
    id: 'calendar',
    name: 'Calendar',
    cat: 'Comms',
    hue: '#c25573',
    blurb: 'Availability, event creation and reschedule proposals.',
    installed: false,
    tools: 14,
    connectors: 1,
    bundled: [],
    accounts: [],
  },
  {
    id: 'postgres',
    name: 'Postgres',
    cat: 'Data',
    hue: '#5aa7c7',
    blurb: 'Read-only SQL against connected databases, with row caps.',
    installed: false,
    tools: 8,
    connectors: 2,
    bundled: [],
    accounts: [],
  },
  {
    id: 'stripe',
    name: 'Stripe',
    cat: 'Data',
    hue: '#5e5ce6',
    blurb: 'Customers, subscriptions and payment state lookups.',
    installed: false,
    tools: 22,
    connectors: 1,
    bundled: [],
    accounts: [],
  },
  {
    id: 'sentry',
    name: 'Sentry',
    cat: 'Dev',
    hue: '#c08a3e',
    blurb: 'Issue streams, regressions and release health.',
    installed: false,
    tools: 11,
    connectors: 1,
    bundled: [],
    accounts: [],
  },
  {
    id: 'figma',
    name: 'Figma',
    cat: 'Design',
    hue: '#cfae4a',
    blurb: 'File trees, frames and comment threads on design files.',
    installed: false,
    tools: 9,
    connectors: 1,
    bundled: [],
    accounts: [],
  },
]

export const SKILLS: Skill[] = [
  {
    id: 's1',
    name: 'Triage a production incident',
    source: 'link',
    origin: 'github.com/willow/runbooks/incident-triage.md',
    enabled: true,
    desc: 'Runbook for sev-1 and sev-2 incidents.',
    md: '# Incident triage\n\n1. Classify severity from the alert payload (sev-1 if user-facing).\n2. Open an incident channel in Slack and invite the on-call lead.\n3. Create a ClickUp task in the Incidents list with the alert link.\n4. Post status updates every 15 minutes until resolved.\n5. When closed, draft a postmortem stub and assign it to the responder.',
  },
  {
    id: 's2',
    name: 'Weekly changelog digest',
    source: 'manual',
    origin: 'Added manually',
    enabled: true,
    desc: 'Compile merged PRs into a Friday digest for #general.',
    md: '# Weekly changelog\n\n- Collect PRs merged since last Friday.\n- Group by area: product, infra, fixes.\n- Summarize each in one line, plain language, no ticket ids.\n- Post to #general at 4pm with the heading "This week we shipped".',
  },
  {
    id: 's3',
    name: 'Escalate stuck ClickUp tasks',
    source: 'link',
    origin: 'notion.so/willow/escalation-playbook',
    enabled: false,
    desc: 'Chase idle tasks before they slip a sprint.',
    md: '# Escalation playbook\n\n1. Find tasks idle for 5+ days in the active sprint.\n2. Ping the assignee in Slack with the task link.\n3. If no reply within 24h, escalate to the team lead.\n4. Never escalate the same task twice in one week.',
  },
]

export const PROVIDERS: Provider[] = [
  {
    id: 'anthropic',
    name: 'Anthropic',
    hue: '#d97748',
    connected: true,
    tag: 'API key',
    auth: 'key',
    desc: 'Direct access to Claude models, including Pro and Max',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    hue: '#2e2e33',
    connected: false,
    tag: 'OAuth',
    auth: 'oauth',
    desc: 'GPT and o-series models with your OpenAI account',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    hue: '#5e5ce6',
    connected: false,
    tag: 'API key',
    auth: 'key',
    badge: 'Recommended',
    desc: 'Curated models including Claude, GPT, Gemini and more',
  },
]

export const SERVER_ROWS = [
  { key: 'Version', val: 'v2.4.1', mono: true, hasUpdate: true },
  { key: 'Server URL', val: 'https://bots.startwillow.com', mono: true },
  { key: 'Status', val: 'Healthy', mono: false },
  { key: 'Uptime', val: '31 days', mono: false },
  { key: 'Bots running', val: '4', mono: false },
]

export function initialOf(s: string) {
  return (s || '?').trim().charAt(0).toUpperCase()
}

export function avatarShapePath(id?: string) {
  return (AVATAR_SHAPES.find((s) => s.id === id) ?? AVATAR_SHAPES[1]).d
}

// Fallback for conversations whose bot no longer exists (e.g. after deletion).
const UNKNOWN_BOT: Bot = {
  id: 'unknown',
  name: 'Unknown Bot',
  color: '#9a9aa0',
  shape: 'squircle',
  model: '',
  prompt: '',
  grants: [],
  memory: '',
}

export function botIn(bots: Bot[], id: string) {
  return bots.find((b) => b.id === id) ?? UNKNOWN_BOT
}

export function pluginById(id: string) {
  return PLUGINS.find((p) => p.id === id)
}
