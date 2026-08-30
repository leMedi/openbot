// Static conversation UI config (composer suggestions, reactions). UI-only.

import type { Author } from './types'

export const YOU: Author = { id: 'you', name: 'You', color: '#3f8f8a', kind: 'user' }

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

