import { StyleSheet } from 'react-native'
import { fontSize, fontWeight, lineHeight, radius, space } from './tokens'

// Static, theme-independent atoms. Usage: `style={[a.flex_row, a.gap_sm]}`.
// Order in arrays: layout → spacing → text → theme atoms → raw overrides.
export const atoms = StyleSheet.create({
  // Layout
  flex_1: { flex: 1 },
  flex_row: { flexDirection: 'row' },
  flex_col: { flexDirection: 'column' },
  flex_wrap: { flexWrap: 'wrap' },
  align_center: { alignItems: 'center' },
  align_start: { alignItems: 'flex-start' },
  align_end: { alignItems: 'flex-end' },
  justify_center: { justifyContent: 'center' },
  justify_between: { justifyContent: 'space-between' },
  justify_end: { justifyContent: 'flex-end' },
  self_stretch: { alignSelf: 'stretch' },
  absolute: { position: 'absolute' },
  relative: { position: 'relative' },
  overflow_hidden: { overflow: 'hidden' },
  w_full: { width: '100%' },
  h_full: { height: '100%' },

  // Gap
  gap_xs: { gap: space.xs },
  gap_sm: { gap: space.sm },
  gap_md: { gap: space.md },
  gap_lg: { gap: space.lg },
  gap_xl: { gap: space.xl },

  // Padding
  p_xs: { padding: space.xs },
  p_sm: { padding: space.sm },
  p_md: { padding: space.md },
  p_lg: { padding: space.lg },
  p_xl: { padding: space.xl },
  px_sm: { paddingHorizontal: space.sm },
  px_md: { paddingHorizontal: space.md },
  px_lg: { paddingHorizontal: space.lg },
  px_xl: { paddingHorizontal: space.xl },
  py_xs: { paddingVertical: space.xs },
  py_sm: { paddingVertical: space.sm },
  py_md: { paddingVertical: space.md },
  py_lg: { paddingVertical: space.lg },
  pt_md: { paddingTop: space.md },
  pt_lg: { paddingTop: space.lg },
  pb_md: { paddingBottom: space.md },
  pb_lg: { paddingBottom: space.lg },

  // Margin
  mt_xs: { marginTop: space.xs },
  mt_sm: { marginTop: space.sm },
  mt_md: { marginTop: space.md },
  mt_lg: { marginTop: space.lg },
  mb_xs: { marginBottom: space.xs },
  mb_sm: { marginBottom: space.sm },
  mb_md: { marginBottom: space.md },
  mb_lg: { marginBottom: space.lg },
  mx_auto: { marginHorizontal: 'auto' },

  // Radius
  rounded_xs: { borderRadius: radius.xs },
  rounded_sm: { borderRadius: radius.sm },
  rounded_md: { borderRadius: radius.md },
  rounded_lg: { borderRadius: radius.lg },
  rounded_xl: { borderRadius: radius.xl },
  rounded_full: { borderRadius: radius.full },

  // Border
  border: { borderWidth: StyleSheet.hairlineWidth },
  border_t: { borderTopWidth: StyleSheet.hairlineWidth },
  border_b: { borderBottomWidth: StyleSheet.hairlineWidth },

  // Text
  text_2xs: { fontSize: fontSize._2xs, lineHeight: fontSize._2xs * lineHeight.snug },
  text_xs: { fontSize: fontSize.xs, lineHeight: fontSize.xs * lineHeight.snug },
  text_sm: { fontSize: fontSize.sm, lineHeight: fontSize.sm * lineHeight.normal },
  text_md: { fontSize: fontSize.md, lineHeight: fontSize.md * lineHeight.normal },
  text_lg: { fontSize: fontSize.lg, lineHeight: fontSize.lg * lineHeight.snug },
  text_xl: { fontSize: fontSize.xl, lineHeight: fontSize.xl * lineHeight.tight },
  text_2xl: { fontSize: fontSize._2xl, lineHeight: fontSize._2xl * lineHeight.tight },
  text_3xl: { fontSize: fontSize._3xl, lineHeight: fontSize._3xl * lineHeight.tight },
  font_normal: { fontWeight: fontWeight.normal },
  font_medium: { fontWeight: fontWeight.medium },
  font_semibold: { fontWeight: fontWeight.semibold },
  font_bold: { fontWeight: fontWeight.bold },
  text_center: { textAlign: 'center' },
  text_left: { textAlign: 'left' },
  leading_tight: { lineHeight: undefined },
})

export type Atoms = typeof atoms
