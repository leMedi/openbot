import { useQuery } from '@tanstack/react-query'
import { orpc } from '#/lib/api'
import { STALE } from '#/lib/query'

export const RQKEY_ROOT = 'conversations'
export const RQKEY = () => orpc.conversations.list.queryKey()

export function useConversationsQuery() {
  return useQuery(orpc.conversations.list.queryOptions({ staleTime: STALE.SECONDS.FIFTEEN }))
}
