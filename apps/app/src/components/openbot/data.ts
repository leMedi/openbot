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

export const BOTS: Bot[] = [
  {
    id: 'po',
    name: 'Willow — PO',
    color: '#5865c4',
    model: 'Sonnet 4.5',
    prompt: 'You keep the sprint board honest. Never invent ticket numbers.',
    grants: [
      ['clickup', 'a1'],
      ['slack', 'a2'],
    ],
    memory:
      '# Memory — Willow — PO\n\n- Sprint cadence: 2 weeks, closes Friday 4pm.\n- Ticket prefix is PROD; never invent ids.\n- Mehdi wants rollover questions batched, not one-by-one.\n- RedRock + Epiq reconciliation tickets follow the same template.',
  },
  {
    id: 'ops',
    name: 'Ops Watch',
    color: '#b0783a',
    model: 'Haiku 4.5',
    prompt: 'Watch error rates overnight. Wake me only above threshold.',
    grants: [['slack', 'a2']],
    memory:
      '# Memory — Ops Watch\n\n- Page threshold: 1.5% error rate, 10-minute window.\n- Warn threshold: 1% (left unchanged on purpose).\n- Quiet-hour reports stay silent unless above threshold.',
  },
  {
    id: 'research',
    name: 'web-search',
    color: '#8a5fc4',
    model: 'Sonnet 4.5',
    prompt: 'Answer with sources. Prefer primary documents.',
    grants: [['chrome', 'a7']],
    memory:
      '# Memory — web-search\n\n- Prefer primary documents; always attach source links.\n- VendorNet portal has a human-verification step.\n- Epiq exposes a public REST API v2; keys via partner portal.',
  },
  {
    id: 'growth',
    name: 'Growth',
    color: '#5f9e63',
    model: 'Opus 4.6',
    prompt: 'Draft outbound copy. Short sentences.',
    grants: [['gmail', 'a4']],
    memory:
      '# Memory — Growth\n\n- Voice: short sentences, no exclamation marks.\n- Churned trials get a plain “what got in the way?” angle.\n- Never email the same contact twice in 14 days.',
  },
]

export const CONVERSATIONS: Conversation[] = [
  {
    id: 'c1',
    botId: 'po',
    title: 'Sprint 78 board sweep',
    time: '12:33 PM',
    pinned: true,
    messages: [
      {
        id: 'm1',
        role: 'bot',
        routine: 'Daily sweep',
        title: 'Board sweep — 34 open',
        text: 'Three groups need you. Nothing auto-changed.',
        items: [
          { key: 'PROD-15196', val: 'Viewport tracking — stale 4d' },
          { key: 'PROD-15520', val: 'Banned patient handling — needs estimate' },
          { key: 'PROD-13226', val: 'Price variation testing — stale 11d' },
        ],
        time: '9:30 AM',
      },
      {
        id: 'm2',
        role: 'user',
        text: 'open a ticket to reconcile RedRock orders on a schedule',
        time: '12:28 PM',
      },
      {
        id: 'm3',
        role: 'bot',
        text: 'Sprint 78, RedRock, no portal link. Filed it.',
        items: [
          { key: 'PROD-15689', val: '[RedRock] Periodically reconcile orders using API' },
        ],
        time: '12:29 PM',
      },
      { id: 'm4', role: 'user', text: 'same for Epiq', time: '12:31 PM' },
      {
        id: 'm5',
        role: 'bot',
        text: 'Same shape, swapped the integration.',
        items: [
          {
            key: 'PROD-15690',
            val: '[Epiq] Periodically reconcile orders using API — Sprint 78, To do',
          },
        ],
        time: '12:31 PM',
      },
      {
        id: 'm5a',
        role: 'user',
        text: 'does Epiq expose a public API for order exports, or do we need the portal?',
        time: '12:32 PM',
      },
      {
        id: 'm5b',
        role: 'bot',
        text: 'Public REST API exists — orders, exports and webhooks. Portal is only needed to issue credentials, so PROD-15690 stays as scoped.',
        time: '12:32 PM',
        delegation: { to: 'research', toName: 'web-search', status: 'done', duration: '14s' },
      },
      {
        id: 'm6',
        role: 'user',
        text: 'PROD-13226 has been stale forever — can we just close it?',
        time: '12:33 PM',
      },
      {
        id: 'm7',
        role: 'bot',
        text: 'It still has an open dependency on PROD-14102. Close it anyway?',
        time: '12:33 PM',
        choice: {
          status: 'pending',
          multi: false,
          options: [
            { id: 'yes', label: 'Yes, close it', hint: 'adds a closing comment' },
            { id: 'no', label: 'No, keep it open' },
          ],
        },
      },
    ],
  },
  {
    id: 'c2',
    botId: 'po',
    title: 'Q3 RFC shortlist',
    time: 'Thu',
    messages: [
      {
        id: 'q1',
        role: 'user',
        text: 'pull the engineering RFCs tagged Q3 into a shortlist',
        time: 'Thu',
      },
      {
        id: 'q2',
        role: 'bot',
        text: "The RFCs live in the org repo — I don't have GitHub access under this bot yet.",
        time: 'Thu',
        access: { plugin: 'GitHub', account: 'org: startwillow', status: 'pending' },
      },
    ],
  },
  {
    id: 'c3',
    botId: 'ops',
    title: 'Page threshold change',
    time: '1:12 AM',
    messages: [
      {
        id: 'n1',
        role: 'bot',
        routine: 'Hourly health',
        text: 'Quiet hour. Error rate 0.4%, p95 at 410ms.',
        time: '1:09 AM',
      },
      { id: 'n2', role: 'user', text: 'lower the page threshold to 1.5%', time: '1:10 AM' },
      {
        id: 'n3',
        role: 'bot',
        text: 'Threshold is 1.5% now. I kept the 10-minute window.',
        time: '1:10 AM',
        thread: [
          {
            id: 'n3t1',
            role: 'user',
            text: 'should the warn threshold come down too?',
            time: '1:11 AM',
          },
          {
            id: 'n3t2',
            role: 'bot',
            text: "Warn sits at 1% — already under the new page threshold, so I left it. Say the word and I'll drop it to 0.8%.",
            time: '1:11 AM',
          },
        ],
      },
      {
        id: 'n4',
        role: 'user',
        text: 'announce the change in #eng-alerts so nobody gets surprised',
        time: '1:12 AM',
      },
      {
        id: 'n5',
        role: 'bot',
        text: 'Drafted the announcement. Posting to a shared channel, so I want a sign-off first.',
        time: '1:12 AM',
        permission: {
          plugin: 'Slack',
          account: 'work',
          action: 'Post to #eng-alerts',
          preview:
            'Page threshold lowered to 1.5% (was 2%). 10-minute window unchanged. Effective now. — Ops Watch',
          status: 'pending',
        },
      },
    ],
  },
  {
    id: 'c4',
    botId: 'research',
    title: 'MCP servers for billing',
    time: 'Fri',
    messages: [
      { id: 'w1', role: 'user', text: 'who ships MCP servers for billing tools?', time: 'Fri' },
      {
        id: 'w2',
        role: 'bot',
        text: 'Pulled six, three are first-party. Want the list in the conversation or as a doc?',
        time: 'Fri',
      },
    ],
  },
  {
    id: 'c5',
    botId: 'research',
    title: 'VendorNet pricing pull',
    time: '2:06 PM',
    unread: true,
    messages: [
      {
        id: 'w3',
        role: 'user',
        text: 'pull the current pricing table from the VendorNet partner portal',
        time: '2:04 PM',
      },
      {
        id: 'w4',
        role: 'bot',
        text: "Got through login, but the portal is showing a verification step I shouldn't click through on my own.",
        time: '2:06 PM',
        remote: {
          machine: 'sandbox-2',
          url: 'portal.vendornet.com/partners/verify',
          blocker: 'Verify you are human',
          status: 'stuck',
        },
      },
    ],
  },
  {
    id: 'c6',
    botId: 'growth',
    title: 'Churned-trials openers',
    time: '9:41 AM',
    messages: [
      {
        id: 'g1',
        role: 'bot',
        text: 'Fresh start here. Give me the segment and I will draft three openers.',
        time: 'Fri',
      },
      {
        id: 'g2',
        role: 'user',
        text: 'draft openers for the churned-trials segment',
        time: '9:41 AM',
      },
      {
        id: 'g3',
        role: 'bot',
        text: 'Which angles should I draft? Pick any that fit.',
        time: '9:41 AM',
        choice: {
          status: 'pending',
          multi: true,
          options: [
            { id: 'price', label: 'New pricing tier' },
            { id: 'feature', label: 'Feature they asked for shipped' },
            { id: 'case', label: 'Customer case study' },
            { id: 'plain', label: 'Plain “what got in the way?”' },
          ],
        },
      },
    ],
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

export function botIn(bots: Bot[], id: string) {
  return bots.find((b) => b.id === id) ?? BOTS[0]
}

export function botById(id: string) {
  return botIn(BOTS, id)
}

export function pluginById(id: string) {
  return PLUGINS.find((p) => p.id === id)
}
