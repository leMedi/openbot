// Mock conversation exercising every row type in the spec. UI-only.

import type { ActivityTab, Author, Entry } from './types'

export const YOU: Author = { id: 'you', name: 'You', color: '#3f8f8a', kind: 'user' }
export const AGENT: Author = { id: 'po', name: 'Willow — PO', color: '#5865c4', kind: 'agent' }
export const MEMBERS: Author[] = [
  { id: 'ops', name: 'Ops Watch', color: '#b0783a', kind: 'member' },
  { id: 'research', name: 'web-search', color: '#8a5fc4', kind: 'member' },
  { id: 'growth', name: 'Growth', color: '#5f9e63', kind: 'member' },
]

export const QUICK_EMOJI = ['👍', '❤️', '😂', '🎉', '👀', '✅']
export const MORE_EMOJI = [
  '😀', '😅', '🤔', '😮', '😢', '🔥', '🚀', '💯', '🙏', '👏',
  '🤖', '🐛', '📌', '⭐', '⚡', '🧠', '💡', '🛠️', '📈', '🍿',
]

export const MENTION_ITEMS = [
  { id: 'willow-po', label: 'Willow — PO', kind: 'member' },
  { id: 'ops-watch', label: 'Ops Watch', kind: 'member' },
  { id: 'web-search', label: 'web-search', kind: 'member' },
  { id: 'growth', label: 'Growth', kind: 'member' },
  { id: 'daily-sweep', label: 'Daily sweep', kind: 'workflow' },
  { id: 'sprint-close', label: 'Sprint close check', kind: 'workflow' },
  { id: 'clickup', label: 'ClickUp', kind: 'mcp' },
  { id: 'slack', label: 'Slack', kind: 'mcp' },
]

export const WORKFLOW_ITEMS = [
  { id: 'daily-sweep', label: 'Daily sweep', kind: 'workflow' },
  { id: 'sprint-close', label: 'Sprint close check', kind: 'workflow' },
  { id: 'triage', label: 'Triage a production incident', kind: 'action' },
  { id: 'changelog', label: 'Weekly changelog digest', kind: 'action' },
  { id: 'escalate', label: 'Escalate stuck tasks', kind: 'action' },
]

export const PR_ITEMS = [
  { id: '1541', label: 'feat(db): reconcile RedRock orders' },
  { id: '1538', label: 'fix(api): dedupe webhook retries' },
  { id: '1533', label: 'chore: bump vite to 8.2' },
  { id: '1529', label: 'feat(app): conversation UI' },
  { id: '1521', label: 'fix(auth): token refresh race' },
  { id: '1515', label: 'docs: on-call runbook' },
  { id: '1508', label: 'feat(bots): routine scheduler' },
  { id: '1502', label: 'refactor: split transcript rows' },
  { id: '1495', label: 'fix(ui): sidebar resize flicker' },
]

const AGENT_MD = `Here's the sweep. **Three groups** need you, nothing auto-changed.

## Stale tickets

| Ticket | Title | Idle |
| --- | --- | --- |
| PROD-15196 | Viewport tracking | 4d |
| PROD-13226 | Price variation testing | 11d |

### Suggested next steps

1. Close ~~PROD-13226~~ *(blocked — see below)*
2. Ask \`@mehdi\` for an estimate on PROD-15520
- [x] Board columns normalized
- [ ] Rollover list drafted

> PROD-13226 still has an open dependency on PROD-14102.

The p95 stays under the target since the error budget reset — formally \\(p_{95} < 410\\,ms\\), and the burn rate is

$$
B = \\frac{\\text{errors}}{\\text{budget}} = 0.31
$$

Full details in the [sprint doc](https://linear.app/willow/sprint-78) or the raw export at https://bots.startwillow.com/exports/78.

---

\`\`\`ts
export function rollover(tickets: Ticket[]) {
  return tickets.filter((t) => t.status !== 'done')
}
\`\`\`

\`\`\`mermaid
flowchart LR
  A[Board sweep] --> B{Stale?}
  B -- yes --> C[Flag + ping assignee]
  B -- no --> D[Skip]
  C --> E[Rollover list]
\`\`\`
`

export const INITIAL_ENTRIES: Entry[] = [
  {
    type: 'timeline',
    id: 'e1',
    text: 'Routine “Daily sweep” ran',
    time: '9:30 AM',
    icon: 'automation',
  },
  {
    type: 'thinking',
    id: 'e2',
    author: AGENT,
    time: '9:30 AM',
    duration: '6s',
    text: 'Scanning the sprint board for tickets with no movement in 3+ days. 34 open, comparing against yesterday’s snapshot before flagging anything.',
  },
  {
    type: 'tool',
    id: 'e3',
    author: AGENT,
    time: '9:30 AM',
    call: {
      name: 'ClickUp · list_tasks',
      preview: 'sprint = 78, status != done — 34 tasks',
      status: 'success',
      detail: 'Fetched 34 tasks in 412ms across 3 pages. Filtered to sprint 78, excluded subtasks.',
    },
    result: {
      kind: 'query',
      command: 'list_tasks(sprint: 78, status_not: done)',
      status: 'success',
      cwd: 'workspace: startwillow',
      output:
        'PROD-15196  Viewport tracking            in-progress   idle 4d\nPROD-15520  Banned patient handling      todo          needs estimate\nPROD-13226  Price variation testing      in-progress   idle 11d\n… 31 more rows',
    },
  },
  {
    type: 'message',
    id: 'e4',
    author: AGENT,
    time: '9:31 AM',
    channel: '#sprint-room',
    markdown: AGENT_MD,
    reactions: [
      { emoji: '👍', users: ['You', 'Ops Watch'] },
      { emoji: '🎉', users: ['Growth'] },
    ],
    thread: [
      {
        type: 'message',
        id: 'e4t1',
        author: YOU,
        time: '9:40 AM',
        text: 'can the sweep also ping assignees directly?',
      },
      {
        type: 'message',
        id: 'e4t2',
        author: AGENT,
        time: '9:40 AM',
        markdown: 'Yes — I can DM the assignee on the **second** stale day. Want that on?',
      },
    ],
  },
  {
    type: 'message',
    id: 'e5',
    author: YOU,
    time: '12:28 PM',
    text: 'open a ticket to reconcile RedRock orders on a schedule',
  },
  {
    type: 'message',
    id: 'e6',
    author: AGENT,
    time: '12:29 PM',
    markdown: 'Sprint 78, RedRock, no portal link. **Filed it.**',
    cards: [
      {
        kind: 'links',
        title: 'Created',
        links: [
          {
            title: 'PROD-15689 — [RedRock] Periodically reconcile orders',
            url: 'https://app.clickup.com/t/prod-15689',
            desc: 'Sprint 78 · To do',
          },
        ],
      },
    ],
  },
  {
    type: 'message',
    id: 'e7',
    author: YOU,
    time: '12:31 PM',
    replyTo: 'e6',
    text: 'same for Epiq — and attach the API notes',
    attachments: [
      { id: 'a1', name: 'epiq-api-notes.md', size: '4 KB', kind: 'file' },
      { id: 'a2', name: 'orders-schema.png', size: '218 KB', kind: 'image' },
    ],
  },
  {
    type: 'message',
    id: 'e8',
    author: AGENT,
    time: '12:32 PM',
    markdown: 'Same shape, swapped the integration. A few cards for you:',
    cards: [
      {
        kind: 'widget',
        title: 'Sprint 78 health',
        stats: [
          { label: 'Open', value: '34' },
          { label: 'Stale', value: '3' },
          { label: 'Done this week', value: '21' },
        ],
      },
      { kind: 'connector', connector: 'ClickUp', account: 'default', status: 'connected' },
      {
        kind: 'draft',
        title: 'Draft — #eng-alerts announcement',
        body: 'Page threshold lowered to 1.5% (was 2%). 10-minute window unchanged.',
      },
      { kind: 'secret', name: 'EPIQ_API_KEY', value: 'epiq_live_9f2d81c4a7b3' },
      {
        kind: 'permission',
        action: 'Post to #eng-alerts',
        detail: 'Slack · work — message will be visible to the whole channel.',
        status: 'pending',
      },
      {
        kind: 'cloud-agent',
        title: 'Reconcile RedRock orders',
        agent: 'cloud: order-reconciler',
        status: 'running',
      },
    ],
  },
  {
    type: 'timeline',
    id: 'e9',
    text: 'Ops Watch and web-search joined the group',
    time: '1:02 PM',
    icon: 'notice',
  },
  {
    type: 'message',
    id: 'e10',
    author: MEMBERS[1],
    time: '1:04 PM',
    markdown:
      'Epiq exposes a public **REST API v2** — orders, exports and webhooks. Keys are issued through the partner portal. Source: [developer.epiq.com](https://developer.epiq.com/orders).',
  },
  {
    type: 'message',
    id: 'e11',
    author: MEMBERS[0],
    time: '1:05 PM',
    markdown: 'Error rate is quiet — 0.4%, p95 at 410ms. No objection to the schedule.',
    reactions: [{ emoji: '👀', users: ['You'] }],
  },
  {
    type: 'message',
    id: 'e12',
    author: YOU,
    time: '1:06 PM',
    text: 'perfect, ship it',
    delivery: 'failed',
  },
  {
    type: 'message',
    id: 'e13',
    author: YOU,
    time: '1:06 PM',
    text: 'and post the announcement after standup',
    delivery: 'queued',
  },
  {
    type: 'message',
    id: 'e14',
    author: YOU,
    time: '1:07 PM',
    text: 'cc the on-call channel too',
    delivery: 'offline-queued',
  },
  {
    type: 'message',
    id: 'e15',
    author: AGENT,
    time: '1:07 PM',
    markdown: '',
    delivery: 'streaming',
  },
]

export const ACTIVITY_TABS: ActivityTab[] = [
  {
    id: 'root',
    title: AGENT.name,
    items: [
      { kind: 'you', text: 'open a ticket to reconcile RedRock orders on a schedule' },
      {
        kind: 'thinking',
        text: 'Same template as the standing reconciliation tickets. Sprint 78 is the active sprint; no portal link exists for RedRock so the ticket should not reference one.',
        summary: 'Reusing the reconciliation template',
      },
      {
        kind: 'tool',
        text: 'create_task(list: "Sprint 78", name: "[RedRock] Periodically reconcile orders using API")',
        toolName: 'ClickUp · create_task',
        toolStatus: 'success',
      },
      { kind: 'agent', text: 'Sprint 78, RedRock, no portal link. Filed it.' },
      { kind: 'message', text: 'Card: PROD-15689 created' },
      {
        kind: 'tool',
        text: 'post_message(channel: "#eng-alerts", draft: true)',
        toolName: 'Slack · post_message',
        toolStatus: 'pending',
      },
    ],
  },
  {
    id: 'sub1',
    subagentType: 'research',
    title: 'Epiq order-export API',
    status: 'done',
    items: [
      { kind: 'you', text: 'Does Epiq expose a public API for order exports?' },
      {
        kind: 'tool',
        text: 'search("epiq partner api order export")',
        toolName: 'Browser · search',
        toolStatus: 'success',
      },
      {
        kind: 'agent',
        text: 'REST API v2 covers orders, exports and webhooks. Keys issued via partner portal.',
      },
    ],
  },
  {
    id: 'sub2',
    subagentType: 'reconciler',
    title: 'RedRock nightly run',
    status: 'running',
    items: [
      {
        kind: 'tool',
        text: 'fetch_orders(since: "2026-08-29T00:00Z")',
        toolName: 'RedRock · fetch_orders',
        toolStatus: 'pending',
      },
    ],
  },
  {
    id: 'sub3',
    subagentType: 'notifier',
    title: 'Standup announcement',
    status: 'aborted',
    items: [],
  },
]
