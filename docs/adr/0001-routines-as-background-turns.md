# ADR 0001: Routines execute as background turns

## Status

Accepted

## Context

OpenBot already has a durable queue whose turn records are both scheduler
items and execution history. Recurring work needs durable definitions,
restart-safe firing, visible delivery, approvals, model history, and failure
recovery without introducing a second execution engine.

## Decision

- Store routine definitions in libSQL and bind each one to an agent and a
  private delivery conversation.
- Fire a cron slot by inserting a typed hidden background turn with a
  `routine_id`, stable slot idempotency key, and full definition snapshot in
  `runtime_context_json`.
- Keep run history in `turns`; do not add a parallel runs table.
- Use five-field cron, IANA timezones, and a 15-minute minimum cadence.
- Permit at most one unsettled run per routine and coalesce missed slots into
  one run rather than backfilling every slot.
- Rebind definitions when a delivery conversation is cleared or deleted.
- Give routine turns MCP, memory, SendMessage, workspace reads, and focused
  self-management. Exclude temporary workers, browser/computer automation, and
  detached shell work until child lifecycle settlement can be represented
  accurately.
- Require approval for model-requested routine mutations. Direct UI mutations
  are already explicit user actions and need no second approval.
- Publish routine activity through a global SSE channel because no composer
  knows a scheduled turn ID in advance.

## Consequences

Routine execution inherits the existing queue's priority, restart recovery,
tool side-effect rules, transcript delivery, and failure model. Conversation
clear intentionally removes routine run history along with other turns; strict
history retention would require a separate durable projection and a later ADR.
Event connectors remain out of scope until cron routines are stable.
