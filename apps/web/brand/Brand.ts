export const WORDMARK_TEXT = 'crook'
export const WORDMARK_WEIGHT = 650
export const WORDMARK_SIZE = 26
export const WORDMARK_BASELINE = 58
export const WORDMARK_TRACKING_EM = -0.03
export const WORDMARK_BOX = 100
export const LIGHT_GROUND = '#FFFFFF'
export const LIGHT_INK = '#201711'
export const DARK_GROUND = '#130E0A'
export const DARK_INK = '#EEEBE4'
export const ICON_GROUND = '#FDFCF8'
export const SPLASH_MARK_SHARE = 0.3

export const WORDMARK_FONT_FILE =
  'node_modules/@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-latin-wght-normal.woff2'

export const WORDMARK_SVG_FILE = 'public/wordmark.svg'

export const inkWordmark = (svg: string, ink: string): string => svg.replaceAll(LIGHT_INK, ink)
