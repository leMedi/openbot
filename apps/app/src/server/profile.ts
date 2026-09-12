import { completeProfileOnboarding, getProfile, updateProfile } from '@openbot/db'
import { getProviderConfiguration } from '@openbot/agent'
import { createServerFn } from '@tanstack/react-start'
import * as z from 'zod'

function isTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format()
    return true
  } catch {
    return false
  }
}

const profileInput = z.object({
  firstName: z.string().trim().max(80),
  lastName: z.string().trim().max(80),
  about: z.string().trim().max(1_000),
  timezone: z.string().trim().min(1).max(100).refine(isTimezone, 'Unknown timezone'),
})

export const getUserProfile = createServerFn({ method: 'GET' }).handler(() =>
  getProfile(),
)

export const saveUserProfile = createServerFn({ method: 'POST' })
  .validator((input: unknown) => profileInput.parse(input))
  .handler(({ data }) => updateProfile(data))

export const completeAppOnboarding = createServerFn({ method: 'POST' }).handler(async () => {
  const [profile, providers] = await Promise.all([
    getProfile(),
    getProviderConfiguration(),
  ])
  if (!profile.firstName.trim()) throw new Error('Enter your first name to continue')
  if (!providers.providers.some((provider) => provider.connected)) {
    throw new Error('Connect an LLM provider to continue')
  }
  return completeProfileOnboarding()
})
