export type DesktopMode = 'disabled' | 'per-agent'

/** Resolve the host-wide desktop capability mode. */
export function getDesktopMode(environment: NodeJS.ProcessEnv = process.env): DesktopMode {
  const configured = environment.OPENBOT_DESKTOP_MODE?.trim()
  if (!configured || configured === 'per-agent') return 'per-agent'
  if (configured === 'disabled') return 'disabled'
  throw new Error(
    `Invalid OPENBOT_DESKTOP_MODE ${JSON.stringify(configured)}; expected "disabled" or "per-agent"`,
  )
}

export function isDesktopEnabled(environment: NodeJS.ProcessEnv = process.env) {
  return getDesktopMode(environment) === 'per-agent'
}

export function isAgentDesktopEnabled(
  displayNumber: number | null | undefined,
  environment: NodeJS.ProcessEnv = process.env,
) {
  return displayNumber != null && isDesktopEnabled(environment)
}
