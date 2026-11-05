import { describe, expect, it } from '@effect/vitest'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, vi } from 'vitest'

import indexCss from '@crook/web/index.css?raw'
import { APP_FONTS, loadFontsEarly } from '@crook/web/text/Fonts'

const THEME_FONT = /^\s*--font-(?:sans|display|mono): '([^']+)'/gmu

const load = vi.fn<(font: string) => Promise<readonly FontFace[]>>()

beforeEach(() => {
  load.mockReset()
  Object.defineProperty(document, 'fonts', { configurable: true, value: { load } })
})

afterEach(() => {
  Reflect.deleteProperty(document, 'fonts')
})

describe('loadFontsEarly', () => {
  it.effect('asks the browser for every family the theme names', () =>
    Effect.gen(function* () {
      load.mockResolvedValue([])

      yield* loadFontsEarly

      const asked = load.mock.calls.map(([font]) => font)
      const themed = Array.from(indexCss.matchAll(THEME_FONT), ([, family = '']) => family)

      expect(asked).toStrictEqual(APP_FONTS)
      expect(themed.length).toBeGreaterThan(0)
      expect(themed.filter((family) => !asked.some((font) => font.includes(family)))).toStrictEqual(
        [],
      )
    }),
  )

  it.effect('carries on without a font the browser could not load', () =>
    Effect.gen(function* () {
      load.mockRejectedValue(new Error('network'))

      yield* loadFontsEarly

      expect(load).toHaveBeenCalledTimes(APP_FONTS.length)
    }),
  )
})
