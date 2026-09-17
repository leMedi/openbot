import { useRouter } from 'expo-router'
import { useState } from 'react'
import { Pressable, TextInput, View } from 'react-native'
import { Screen } from '#/components/Screen'
import { Text } from '#/components/Text'
import { api } from '#/lib/api'
import { normalizeServerUrl, setServerUrl, useServerUrl } from '#/state/server'
import { a, useTheme } from '#/theme'

// Placeholder screen: the layout will follow the design screenshots. The
// connection logic (normalize, probe, persist) is final.
export default function Connect() {
  const t = useTheme()
  const router = useRouter()
  const [value, setValue] = useState(useServerUrl() ?? '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function connect() {
    const origin = normalizeServerUrl(value)
    if (!origin) {
      setError('Enter a server address like 192.168.1.10:3000')
      return
    }
    setBusy(true)
    setError(null)
    const previous = value
    setServerUrl(origin)
    try {
      await api.profile.get()
      router.replace('/conversations')
    } catch (cause) {
      setServerUrl(previous ? normalizeServerUrl(previous) : null)
      setError(cause instanceof Error ? cause.message : 'Could not reach the server')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Screen>
      <View style={[a.flex_1, a.justify_center, a.px_xl, a.gap_lg]}>
        <Text style={[a.text_2xl, a.font_semibold]}>Connect to OpenBot</Text>
        <Text style={t.atoms.text_muted}>The address of your OpenBot server.</Text>
        <TextInput
          value={value}
          onChangeText={setValue}
          onSubmitEditing={connect}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          placeholder="192.168.1.10:3000"
          placeholderTextColor={t.palette.textFaint}
          style={[a.px_lg, a.py_md, a.rounded_md, a.border, a.text_md, t.atoms.bg_inset, t.atoms.border, t.atoms.text]}
        />
        {error ? <Text style={[a.text_sm, t.atoms.text_danger]}>{error}</Text> : null}
        <Pressable
          onPress={connect}
          disabled={busy}
          style={[a.py_md, a.rounded_full, a.align_center, t.atoms.bg_primary, busy && { opacity: 0.6 }]}
        >
          <Text style={[a.font_semibold, t.atoms.text_on_primary]}>{busy ? 'Connecting…' : 'Connect'}</Text>
        </Pressable>
      </View>
    </Screen>
  )
}
