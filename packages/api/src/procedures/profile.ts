import { completeProfileOnboarding, getProfile, updateProfile } from '@openbot/db'
import { getProviderConfiguration } from '@openbot/agent'
import * as z from 'zod'
import { badRequest, base } from '../base'

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

export const profile = {
  get: base.handler(() => getProfile()),

  update: base.input(profileInput).handler(({ input }) => updateProfile(input)),

  completeOnboarding: base.handler(async () => {
    const [current, providers] = await Promise.all([
      getProfile(),
      getProviderConfiguration(),
    ])
    if (!current.firstName.trim()) throw badRequest('Enter your first name to continue')
    if (!providers.providers.some((provider) => provider.connected)) {
      throw badRequest('Connect an LLM provider to continue')
    }
    return completeProfileOnboarding()
  }),
}
