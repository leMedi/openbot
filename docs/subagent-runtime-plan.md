# Grok-compatible subagent runtime plan

## Goal

Give OpenBot the same essential temporary-agent behavior as Grok Bot's `Task`,
`CheckSubagent`, `MessageSubagent`, and `StopSubagent` surfaces while preserving
OpenBot's durable turn queue and server-owned execution model.

Temporary subagents remain child `turns`, not persistent `agents`. Their model
history lives in isolated Pi session directories and their results return via
idempotent completion wake turns.

## Target behavior

- `Task` dispatches `executor`, `browserUse`, and `computerUse` subagent types.
- A parent continues running after dispatch; workers use independent execution
  slots rather than the parent's serial foreground lane.
- `CheckSubagent` reports status, elapsed time, observed tool calls, and recent
  activity.
- `MessageSubagent` records guidance durably, interrupts the active model run,
  and continues the same isolated session.
- `StopSubagent` durably cancels queued/running work and releases live resources.
- Server restart reclaims queued workers and reapplies steering that was
  requested but not marked applied.
- The existing one-browser-worker and one-computer-worker limits remain. Executor
  workers initially allow four unsettled executions per agent.

## Delivery plan

### 1. Durable generic worker foundation — implemented

- Add an internal `general-subagent` turn mode for `executor` and versioned runtime/wake contracts.
- Add independent atomic worker claiming.
- Exclude worker turns from foreground scheduling and supersession.
- Add isolated Pi session storage and completion wake handling.
- Recover queued workers independently after restart.

### 2. Grok-compatible tool surface — implemented

- Add `Task` with `executor`, `browserUse`, and `computerUse` dispatch.
- Add `CheckSubagent`, `MessageSubagent`, and `StopSubagent`.
- Preserve `browserUse` and `computerUse` as compatibility aliases.
- Prevent worker-to-user delivery and nested generic delegation.

### 3. Concurrent execution and management — implemented in backend

- Launch all temporary workers outside the owning agent's foreground drain.
- Permit later foreground user turns while workers continue.
- Project live and durable worker activity.
- Cancel worker executions during agent teardown.
- Expose server functions for listing, steering, and stopping workers.

### 4. Durable steering — implemented in backend

- Store requested/applied steering events in the internal transcript.
- Deduplicate requests by worker, requesting turn, and tool call.
- Interrupt active Pi inference and continue the same session with the update.
- Reapply an unacknowledged request after process recovery.

### 5. UI management surface — implemented

- Render active workers in a conversation-scoped management panel.
- Show type, title, elapsed time, status, and recent activity.
- Add guidance input and Stop controls backed by server functions.
- Keep worker controls visible after the parent stream hands off or a new user
  turn begins.

### 6. Remaining fidelity hardening

- Add `Task` resume for completed subagent sessions.
- Add explicit read-only Task execution and enforce it across Shell and MCP.
- Add configurable model selection, timeout, token, and tool-call budgets.
- Add approval review for steering and delegated capability escalation.
- Add per-worker transcript projection without exposing server filesystem paths.
- Add structured usage and lifecycle telemetry.
- Decide whether custom subagent definitions should remain deferred.

## Invariants

- Worker output is untrusted input to the parent, never user authority.
- A worker cannot use `SendMessage`, mutate memory, or recursively launch Task.
- A failed or cancelled ancestor prevents a queued child from being claimed.
- Foreground execution remains one active turn per agent.
- Computer/browser mutation remains protected by the existing display lease and
  action-review mechanisms.
- Tool and permission snapshots remain attached to every executed worker turn.
