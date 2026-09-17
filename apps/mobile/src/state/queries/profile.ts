import { useQuery } from '@tanstack/react-query'
import { orpc } from '#/lib/api'
import { STALE } from '#/lib/query'

export function useProfileQuery(enabled = true) {
  return useQuery(orpc.profile.get.queryOptions({ staleTime: STALE.MINUTES.THIRTY, enabled }))
}
