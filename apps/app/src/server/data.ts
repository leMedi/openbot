import { cleanData, listConversations } from '@openbot/db'
import { createServerFn } from '@tanstack/react-start'
import * as z from 'zod'

export const appDataTargets = ['conversations', 'bots', 'memory'] as const
export type AppDataTarget = (typeof appDataTargets)[number]

const clearAppDataInput = z.object({
  targets: z.array(z.enum(appDataTargets)).min(1),
})

export const clearAppData = createServerFn({ method: 'POST' })
  .validator((input: unknown) => clearAppDataInput.parse(input))
  .handler(async ({ data }) => {
    const result = await cleanData(new Set(data.targets))
    const [firstConversation] = await listConversations()
    return {
      result,
      firstConversationId: firstConversation?.id ?? null,
    }
  })
