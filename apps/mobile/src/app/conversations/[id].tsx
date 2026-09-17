import { useQuery } from '@tanstack/react-query'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { Pressable, View } from 'react-native'
import { Screen } from '#/components/Screen'
import { Text } from '#/components/Text'
import { orpc } from '#/lib/api'
import { STALE } from '#/lib/query'
import { a, useTheme } from '#/theme'

// Placeholder detail: fetches the transcript rows. The conversation UI and
// live turn stream land with the designs.
export default function Conversation() {
  const t = useTheme()
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id: string }>()
  const query = useQuery(
    orpc.messages.list.queryOptions({ input: { conversationId: id }, staleTime: STALE.SECONDS.FIFTEEN }),
  )

  return (
    <Screen>
      <View style={[a.flex_row, a.align_center, a.gap_md, a.px_lg, a.py_md]}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Text style={t.atoms.text_muted}>‹ Back</Text>
        </Pressable>
        <Text style={[a.font_semibold]} numberOfLines={1}>
          {id}
        </Text>
      </View>
      <View style={[a.px_lg]}>
        {query.isPending ? (
          <Text style={t.atoms.text_muted}>Loading…</Text>
        ) : query.isError ? (
          <Text style={t.atoms.text_danger}>{query.error.message}</Text>
        ) : (
          <Text style={t.atoms.text_muted}>
            {query.data.rows.length} messages
            {query.data.pendingTurnId ? ' · turn in progress' : ''}
          </Text>
        )}
      </View>
    </Screen>
  )
}
