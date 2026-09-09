import { cleanManagedData } from '@openbot/agent'
import { type CleanTarget, listConversations } from '@openbot/db'
import { createServerFn } from '@tanstack/react-start'
import * as z from 'zod'

export const appDataTargets = ['conversations', 'bots', 'memory', 'plugins'] as const
export type AppDataTarget = (typeof appDataTargets)[number]

export function toCleanTargets(targets: readonly AppDataTarget[]) {
  return new Set<CleanTarget>(
    targets.map((target) => target === 'plugins' ? 'mcps' : target),
  )
}

const clearAppDataInput = z.object({
  targets: z.array(z.enum(appDataTargets)).min(1),
})

export const clearAppData = createServerFn({ method: 'POST' })
  .validator((input: unknown) => clearAppDataInput.parse(input))
  .handler(async ({ data }) => {
    const result = await cleanManagedData(toCleanTargets(data.targets))
    const [firstConversation] = await listConversations()
    return {
      result,
      firstConversationId: firstConversation?.id ?? null,
    }
  })
