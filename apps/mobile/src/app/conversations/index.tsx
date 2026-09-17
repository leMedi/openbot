import { conversationFromRow } from '@openbot/client/openbot/conversations'
import { FlashList } from '@shopify/flash-list'
import { Link, useRouter } from 'expo-router'
import { Pressable, View } from 'react-native'
import { Screen } from '#/components/Screen'
import { Text } from '#/components/Text'
import { useConversationsQuery } from '#/state/queries/conversations'
import { setServerUrl } from '#/state/server'
import { a, useTheme } from '#/theme'

// Placeholder list: proves the data path end to end. Visuals come later.
export default function Conversations() {
  const t = useTheme()
  const router = useRouter()
  const query = useConversationsQuery()

  return (
    <Screen>
      <View style={[a.flex_row, a.align_center, a.justify_between, a.px_lg, a.py_md]}>
        <Text style={[a.text_xl, a.font_semibold]}>Conversations</Text>
        <Pressable
          onPress={() => {
            setServerUrl(null)
            router.replace('/connect')
          }}
        >
          <Text style={[a.text_sm, t.atoms.text_muted]}>Disconnect</Text>
        </Pressable>
      </View>
      {query.isPending ? (
        <Text style={[a.px_lg, t.atoms.text_muted]}>Loading…</Text>
      ) : query.isError ? (
        <Text style={[a.px_lg, t.atoms.text_danger]}>{query.error.message}</Text>
      ) : (
        <FlashList
          data={query.data}
          keyExtractor={(item) => item.id}
          onRefresh={() => query.refetch()}
          refreshing={query.isRefetching}
          renderItem={({ item: row }) => {
            const item = conversationFromRow(row)
            return (
              <Link href={{ pathname: '/conversations/[id]', params: { id: item.id } }} asChild>
                <Pressable style={[a.flex_row, a.align_center, a.justify_between, a.px_lg, a.py_md, a.border_b, t.atoms.border]}>
                  <Text style={[a.font_medium, item.unread && a.font_semibold]} numberOfLines={1}>
                    {item.title}
                  </Text>
                  <Text style={[a.text_sm, t.atoms.text_muted]}>{item.time}</Text>
                </Pressable>
              </Link>
            )
          }}
        />
      )}
    </Screen>
  )
}
