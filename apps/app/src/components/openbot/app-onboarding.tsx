import { useEffect, useState } from 'react'
import type { ProviderConfigurationDto } from '@openbot/agent'
import type { Profile, Setting } from '@openbot/db'
import { Check, ChevronLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { completeAppOnboarding, saveUserProfile } from '@/server/profile'
import { ProvidersTab } from './settings-dialog'

export const APP_ONBOARDING_COPY = {
  profileTitle: 'Tell OpenBot about you',
  profileDescription: 'Your agents use this profile to understand who they are helping.',
  providerTitle: 'Connect an LLM provider',
  providerDescription: 'Connect any available provider so your agents can think and respond.',
  next: 'Continue to providers',
  finish: 'Continue to OpenBot',
} as const

export function AppOnboarding({
  profile,
  providerConfiguration,
  onComplete,
}: {
  profile: Profile
  providerConfiguration: ProviderConfigurationDto & { setting: Setting }
  onComplete: (profile: Profile) => void | Promise<void>
}) {
  const [step, setStep] = useState<1 | 2>(1)
  const [firstName, setFirstName] = useState(profile.firstName)
  const [lastName, setLastName] = useState(profile.lastName)
  const [about, setAbout] = useState(profile.about)
  const [timezone, setTimezone] = useState(profile.timezone)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [timezones, setTimezones] = useState(() =>
    Array.from(new Set([profile.timezone, 'UTC'].filter(Boolean))),
  )

  useEffect(() => {
    const supported = typeof Intl.supportedValuesOf === 'function'
      ? Intl.supportedValuesOf('timeZone')
      : []
    const detected = Intl.DateTimeFormat().resolvedOptions().timeZone
    setTimezones(Array.from(new Set([profile.timezone, detected, 'UTC', ...supported].filter(Boolean))))
    if (!profile.timezone) setTimezone(detected || 'UTC')
  }, [profile.timezone])

  async function saveAndContinue() {
    if (!firstName.trim() || !timezone || busy) return
    setBusy(true)
    setError('')
    try {
      await saveUserProfile({ data: { firstName, lastName, about, timezone } })
      setStep(2)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Your profile could not be saved')
    } finally {
      setBusy(false)
    }
  }

  async function finish() {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const completed = await completeAppOnboarding()
      await onComplete(completed)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Onboarding could not be completed')
      setBusy(false)
    }
  }

  return (
    <Dialog open={!profile.onboardingCompleted} onOpenChange={() => {}}>
      <DialogContent showCloseButton={false} className="flex max-h-[90vh] flex-col overflow-hidden p-0 sm:max-w-2xl">
        <DialogTitle className="sr-only">Set up OpenBot</DialogTitle>
        <div className="flex items-center gap-2 border-b px-6 py-4">
          {[1, 2].map((number) => (
            <div key={number} className="flex flex-1 items-center gap-2">
              <span className={`flex size-6 items-center justify-center rounded-full text-xs font-semibold ${step >= number ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>
                {step > number ? <Check className="size-3.5" /> : number}
              </span>
              <span className="text-xs font-medium">{number === 1 ? 'Your profile' : 'LLM provider'}</span>
            </div>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
          {step === 1 ? (
            <div className="mx-auto max-w-lg">
              <h2 className="text-xl font-bold tracking-tight">{APP_ONBOARDING_COPY.profileTitle}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{APP_ONBOARDING_COPY.profileDescription}</p>
              <div className="mt-6 grid grid-cols-2 gap-3">
                <label className="flex flex-col gap-1.5 text-xs font-medium">First name
                  <Input autoFocus required value={firstName} onChange={(event) => setFirstName(event.target.value)} maxLength={80} />
                </label>
                <label className="flex flex-col gap-1.5 text-xs font-medium">Last name
                  <Input value={lastName} onChange={(event) => setLastName(event.target.value)} maxLength={80} />
                </label>
                <label className="col-span-2 flex flex-col gap-1.5 text-xs font-medium">Timezone
                  <select value={timezone} onChange={(event) => setTimezone(event.target.value)} className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30">
                    {timezones.map((value) => <option key={value} value={value}>{value.replaceAll('_', ' ')}</option>)}
                  </select>
                </label>
                <label className="col-span-2 flex flex-col gap-1.5 text-xs font-medium">About you
                  <Textarea value={about} onChange={(event) => setAbout(event.target.value)} placeholder="Your role, preferences, and anything your agents should know" maxLength={1000} className="min-h-28" />
                </label>
              </div>
            </div>
          ) : (
            <div className="mx-auto max-w-xl">
              <h2 className="text-xl font-bold tracking-tight">{APP_ONBOARDING_COPY.providerTitle}</h2>
              <p className="mt-1 mb-6 text-sm text-muted-foreground">{APP_ONBOARDING_COPY.providerDescription}</p>
              <ProvidersTab initialConfiguration={providerConfiguration} onChanged={() => {}} showModelDefaults={false} />
            </div>
          )}
        </div>

        <div className="flex items-center gap-3 border-t px-6 py-4">
          {step === 2 && <Button variant="ghost" disabled={busy} onClick={() => setStep(1)}><ChevronLeft data-icon="inline-start" /> Back</Button>}
          <span role="alert" className="min-w-0 flex-1 text-xs text-destructive">{error}</span>
          {step === 1 ? (
            <Button disabled={busy || !firstName.trim() || !timezone} onClick={() => void saveAndContinue()}>{busy ? 'Saving…' : APP_ONBOARDING_COPY.next}</Button>
          ) : (
            <Button disabled={busy} onClick={() => void finish()}>{busy ? 'Checking…' : APP_ONBOARDING_COPY.finish}</Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
