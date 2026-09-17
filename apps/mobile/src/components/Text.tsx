import { Text as RNText, type TextProps } from 'react-native'
import { a, useTheme } from '#/theme'

// Every piece of text goes through here so the theme color and base size are
// never forgotten (Bluesky's avoid-unwrapped-text rule).
export function Text({ style, ...props }: TextProps) {
  const t = useTheme()
  return <RNText {...props} style={[a.text_md, t.atoms.text, style]} />
}
