import { readFile } from 'node:fs/promises'

import {
  AllAppleDeviceNames,
  appleSplashScreenSizes,
  defineConfig,
  minimal2023Preset,
} from '@vite-pwa/assets-generator/config'
import type { AppleSplashScreens } from '@vite-pwa/assets-generator/config'

import {
  DARK_GROUND,
  DARK_INK,
  ICON_GROUND,
  inkWordmark,
  LIGHT_GROUND,
  SPLASH_MARK_SHARE,
  WORDMARK_SVG_FILE,
} from './brand/Brand.ts'

const FULL_BLEED = {
  padding: 0,
  resizeOptions: { background: ICON_GROUND, fit: 'contain' },
} as const

const darkWordmark = async (): Promise<Buffer> =>
  Buffer.from(inkWordmark(await readFile(WORDMARK_SVG_FILE, 'utf8'), DARK_INK))

const SPLASH_SCREENS: AppleSplashScreens = {
  sizes: AllAppleDeviceNames.filter((device) => device.startsWith('iPhone')).map(
    (device) => appleSplashScreenSizes[device],
  ),
  padding: 1 - SPLASH_MARK_SHARE,
  resizeOptions: { background: LIGHT_GROUND, fit: 'contain' },
  darkResizeOptions: { background: DARK_GROUND, fit: 'contain' },
  darkImageResolver: darkWordmark,
  linkMediaOptions: { log: false, addMediaScreen: true, xhtml: false, basePath: '/' },
}

export default defineConfig({
  headLinkOptions: { preset: '2023' },
  preset: {
    transparent: { ...minimal2023Preset.transparent, ...FULL_BLEED },
    maskable: { ...minimal2023Preset.maskable, ...FULL_BLEED },
    apple: { ...minimal2023Preset.apple, ...FULL_BLEED },
    appleSplashScreens: SPLASH_SCREENS,
  },
  images: [WORDMARK_SVG_FILE],
})
