import { color } from './tokens'

export type ThemeName = 'dark' | 'light'

export type Palette = {
  bg: string
  bgElevated: string
  bgInset: string
  border: string
  borderStrong: string
  text: string
  textMuted: string
  textFaint: string
  primary: string
  onPrimary: string
  danger: string
  success: string
}

export const palettes: Record<ThemeName, Palette> = {
  dark: {
    bg: color.gray_950,
    bgElevated: color.gray_900,
    bgInset: color.gray_800,
    border: color.gray_700,
    borderStrong: color.gray_500,
    text: color.gray_25,
    textMuted: color.gray_300,
    textFaint: color.gray_500,
    primary: color.gray_25,
    onPrimary: color.gray_950,
    danger: color.red,
    success: color.green,
  },
  light: {
    bg: color.gray_0,
    bgElevated: color.gray_25,
    bgInset: '#e8e8ea',
    border: color.gray_100,
    borderStrong: color.gray_300,
    text: color.gray_950,
    textMuted: color.gray_500,
    textFaint: color.gray_300,
    primary: color.gray_950,
    onPrimary: color.gray_0,
    danger: color.red,
    success: color.green,
  },
}
