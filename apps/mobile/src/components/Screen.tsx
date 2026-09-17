import type { ViewProps } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { a, useTheme } from '#/theme'

export function Screen({ style, ...props }: ViewProps) {
  const t = useTheme()
  return <SafeAreaView {...props} style={[a.flex_1, t.atoms.bg, style]} />
}
