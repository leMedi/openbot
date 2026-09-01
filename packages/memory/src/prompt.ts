// Prompt-visible memory sections rendered into the agent system prompt.

import type { MemoryItem } from '@openbot/db'

// Prompt-visible memory is bounded; everything older stays reachable through
// the recallMemory tool.
const PROFILE_RECORD_LIMIT = 50
const RECENT_RECORD_LIMIT = 15
const PROFILE_CHAR_BUDGET = 4_000
const RECENT_CHAR_BUDGET = 2_000

function learnedDate(item: MemoryItem) {
  return new Date(item.createdAt).toISOString().slice(0, 10)
}

function renderFactLines(
  items: MemoryItem[],
  options: { recordLimit: number; charBudget: number; withVia: boolean },
) {
  const lines: string[] = []
  let spent = 0
  let omitted = 0
  for (const item of items) {
    const via =
      options.withVia && item.authoredByAgentName
        ? ` [via ${item.authoredByAgentName}]`
        : ''
    const line = `- (learned ${learnedDate(item)})${via} ${item.content}`
    if (lines.length >= options.recordLimit || spent + line.length > options.charBudget) {
      omitted += 1
      continue
    }
    lines.push(line)
    spent += line.length
  }
  return { lines, omitted }
}

/**
 * One bounded fact list: profile facts (oldest first) then recent log/note
 * facts (newest first), with an omission line when records exceed the
 * record and character budgets.
 */
function renderFactSection(items: MemoryItem[], withVia: boolean) {
  const profile = renderFactLines(
    items.filter((item) => item.kind === 'profile'),
    { recordLimit: PROFILE_RECORD_LIMIT, charBudget: PROFILE_CHAR_BUDGET, withVia },
  )
  const recent = renderFactLines(
    items
      .filter((item) => item.kind !== 'profile')
      .sort((a, b) => b.updatedAt - a.updatedAt || (a.id < b.id ? 1 : -1)),
    { recordLimit: RECENT_RECORD_LIMIT, charBudget: RECENT_CHAR_BUDGET, withVia },
  )
  const omitted = profile.omitted + recent.omitted
  return {
    lines: [
      ...profile.lines,
      ...recent.lines,
      ...(omitted > 0
        ? [`(${omitted} more fact${omitted === 1 ? '' : 's'} not shown — search them with recallMemory.)`]
        : []),
    ],
  }
}

/** Shared-user memory section: facts every assistant of this user can see. */
export function renderUserMemorySystemPrompt(items: MemoryItem[]): string {
  const shared = items.filter((item) => item.scope === 'user')
  if (shared.length === 0) return ''
  const { lines } = renderFactSection(shared, true)
  return [
    "User memory: durable facts shared across every assistant this user runs — their name, timezone, lasting preferences, and anything all of the user's assistants should know. This is separate from your own memory (shown below) and is visible to all of them.",
    'Precedence: when a shared user fact conflicts with your OWN memory, prefer your own — it is curated for your role and may deliberately override a shared default.',
    '',
    'Shared user memory is searchable with the recallMemory tool (scope "user"). To CHANGE it, use the updateMemory tool (scope "user", action "update" or "forget"). Never edit another assistant\'s private memory.',
    '',
    'To fix or replace a shared fact another assistant recorded, record the corrected fact with updateMemory — the newest wins on conflict. Record a fact here only when it is clearly about the user and useful to every assistant; keep role-specific facts in your own memory (scope "agent").',
    '',
    'Shared facts are tagged [via <assistant>] so you can tell which assistant learned each one.',
    'About the user (shared):',
    ...lines,
  ].join('\n')
}

/** Agent-scoped memory section: facts private to this agent. */
export function renderMemorySystemPrompt(items: MemoryItem[]): string {
  const scoped = items.filter((item) => item.scope === 'agent')
  if (scoped.length === 0) return ''
  const { lines } = renderFactSection(scoped, false)
  return [
    'Memory: durable facts you have learned about the user and their world.',
    'These persist across every conversation with this agent, even after the chat is cleared. Rely on them so you stay consistent and avoid re-asking what you already know.',
    'Your memory is searchable with the recallMemory tool (scope "agent") — use it when you need older facts that are not listed here. To CHANGE memory, use the updateMemory tool: action "update" with a fact and a kind (profile | log | note), or action "forget" with the item\'s id.',
    'About the user:',
    ...lines,
  ].join('\n')
}

/** The full memory block: shared-user facts first, then agent-private facts. */
export function renderMemoryPrompt(items: MemoryItem[]): string {
  return [renderUserMemorySystemPrompt(items), renderMemorySystemPrompt(items)]
    .filter(Boolean)
    .join('\n\n')
}
