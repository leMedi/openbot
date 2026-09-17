import { createContext, useContext, useMemo } from 'react'
import { StyleSheet, useColorScheme } from 'react-native'
import { atoms } from './atoms'
import { palettes, type Palette, type ThemeName } from './themes'

export { atoms as a } from './atoms'
export * as tokens from './tokens'
export type { Palette, ThemeName } from './themes'

export type Theme = {
  name: ThemeName
  palette: Palette
  /** Theme-dependent atoms: `t.atoms.bg`, `t.atoms.text_muted`, … */
  atoms: ReturnType<typeof themeAtoms>
}

function themeAtoms(p: Palette) {
  return StyleSheet.create({
    bg: { backgroundColor: p.bg },
    bg_elevated: { backgroundColor: p.bgElevated },
    bg_inset: { backgroundColor: p.bgInset },
    bg_primary: { backgroundColor: p.primary },
    border: { borderColor: p.border },
    border_strong: { borderColor: p.borderStrong },
    text: { color: p.text },
    text_muted: { color: p.textMuted },
    text_faint: { color: p.textFaint },
    text_on_primary: { color: p.onPrimary },
    text_danger: { color: p.danger },
    text_success: { color: p.success },
  })
}

const themes: Record<ThemeName, Theme> = {
  dark: { name: 'dark', palette: palettes.dark, atoms: themeAtoms(palettes.dark) },
  light: { name: 'light', palette: palettes.light, atoms: themeAtoms(palettes.light) },
}

const ThemeContext = createContext<Theme>(themes.dark)

export function ThemeProvider({
  name,
  children,
}: {
  /** Force a theme; defaults to the OS scheme, dark when unknown. */
  name?: ThemeName
  children: React.ReactNode
}) {
  const scheme = useColorScheme()
  const theme = useMemo(() => themes[name ?? (scheme === 'light' ? 'light' : 'dark')], [name, scheme])
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>
}

export function useTheme(): Theme {
  return useContext(ThemeContext)
}

/** Static atoms alongside the theme, for components that need both. */
export function useAlf() {
  const t = useTheme()
  return { a: atoms, t }
}
