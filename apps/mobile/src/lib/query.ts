import { QueryClient } from '@tanstack/react-query'

// `staleTime` is load-bearing (Bluesky convention): every query declares how
// long its data stays fresh instead of relying on a global default.
export const STALE = {
  SECONDS: { FIFTEEN: 15_000, THIRTY: 30_000 },
  MINUTES: { ONE: 60_000, FIVE: 300_000, THIRTY: 1_800_000 },
  HOURS: { ONE: 3_600_000 },
  INFINITY: Number.POSITIVE_INFINITY,
} as const

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: STALE.SECONDS.FIFTEEN,
        retry: 1,
        refetchOnWindowFocus: false,
      },
    },
  })
}
