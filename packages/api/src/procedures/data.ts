import { cleanManagedData } from '@openbot/agent'
import { type CleanTarget, listConversations } from '@openbot/db'
import * as z from 'zod'
import { base } from '../base'

export const appDataTargets = ['conversations', 'bots', 'memory', 'plugins'] as const
export type AppDataTarget = (typeof appDataTargets)[number]

export function toCleanTargets(targets: readonly AppDataTarget[]) {
  return new Set<CleanTarget>(
    targets.map((target) => target === 'plugins' ? 'mcps' : target),
  )
}

export const data = {
  clear: base
    .input(z.object({ targets: z.array(z.enum(appDataTargets)).min(1) }))
    .handler(async ({ input }) => {
      const result = await cleanManagedData(toCleanTargets(input.targets))
      const [firstConversation] = await listConversations()
      return { result, firstConversationId: firstConversation?.id ?? null }
    }),
}
