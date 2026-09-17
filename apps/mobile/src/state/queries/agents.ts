import { useQuery } from '@tanstack/react-query'
import { orpc } from '#/lib/api'
import { STALE } from '#/lib/query'

export const RQKEY_ROOT = 'agents'
export const RQKEY = () => orpc.agents.list.queryKey()

export function useAgentsQuery() {
  return useQuery(orpc.agents.list.queryOptions({ staleTime: STALE.MINUTES.FIVE }))
}

export function useGroupsQuery() {
  return useQuery(orpc.groups.list.queryOptions({ staleTime: STALE.MINUTES.FIVE }))
}
