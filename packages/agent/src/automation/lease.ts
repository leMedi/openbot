type AutomationLease = { owner: string }

const automationLeases = new Map<string, AutomationLease>()

export function x11AutomationLeaseKey(display: number) {
  return `x11:${String(display)}`
}

/** Visible for deterministic concurrency tests and process diagnostics. */
export function activeAutomationLease(key: string) {
  return automationLeases.get(key)?.owner
}

export function tryAcquireAutomationLease(key: string, owner: string) {
  if (automationLeases.has(key)) return false
  automationLeases.set(key, { owner })
  return true
}

export function releaseAutomationLease(key: string, owner: string) {
  if (automationLeases.get(key)?.owner === owner) automationLeases.delete(key)
}
