// T-shirt scale tokens. Everything visual derives from these, never from raw
// numbers in components (Bluesky ALF convention).

export const space = {
  _2xs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  _2xl: 24,
  _3xl: 32,
  _4xl: 40,
  _5xl: 56,
} as const

export const fontSize = {
  _2xs: 10,
  xs: 12,
  sm: 14,
  md: 16,
  lg: 18,
  xl: 22,
  _2xl: 26,
  _3xl: 32,
} as const

export const lineHeight = {
  none: 1,
  tight: 1.15,
  snug: 1.3,
  normal: 1.5,
} as const

export const radius = {
  _2xs: 4,
  xs: 6,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  full: 999,
} as const

export const fontWeight = {
  normal: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
} as const

export const color = {
  // Neutrals, dark-first to match the web app's default theme.
  gray_0: '#ffffff',
  gray_25: '#f2f2f2',
  gray_100: '#d4d4d8',
  gray_300: '#9a9aa0',
  gray_500: '#5c5c63',
  gray_700: '#2a2a2f',
  gray_800: '#1c1c20',
  gray_900: '#121215',
  gray_950: '#0b0b0d',

  // Accents, matching AVATAR_COLORS in @openbot/client.
  amber: '#b0783a',
  rose: '#b3536e',
  terracotta: '#c46b4a',
  green: '#5f9e63',
  teal: '#3f8f8a',
  indigo: '#5865c4',
  violet: '#8a5fc4',

  red: '#d0554f',
} as const
