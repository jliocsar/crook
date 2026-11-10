import * as BunFileSystem from '@effect/platform-bun/BunFileSystem'
import { describe, expect, it, layer } from '@effect/vitest'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'

import { DARK_INK, inkWordmark, WORDMARK_FONT_FILE, WORDMARK_SVG_FILE } from '../../brand/Brand.ts'
import { decodeWordmarkFont, outlineWordmark } from '../../brand/OutlineWordmark.ts'
import { scopeLightSplashLinks } from '../../brand/SplashLinks.ts'

const LIGHT_LINK =
  '<link rel="apple-touch-startup-image" media="screen and (device-width: 393px) and (orientation: portrait)" href="/apple-splash-portrait-light-1179x2556.png">'
const SCOPED_LIGHT_LINK =
  '<link rel="apple-touch-startup-image" media="screen and (prefers-color-scheme: light) and (device-width: 393px) and (orientation: portrait)" href="/apple-splash-portrait-light-1179x2556.png">'
const DARK_LINK =
  '<link rel="apple-touch-startup-image" media="screen and (prefers-color-scheme: dark) and (device-width: 393px) and (orientation: portrait)" href="/apple-splash-portrait-dark-1179x2556.png">'

layer(BunFileSystem.layer)('wordmark', (effectIt) => {
  effectIt.effect('the committed outline matches the installed font', () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const font = yield* decodeWordmarkFont(yield* fileSystem.readFile(WORDMARK_FONT_FILE))
      const committed = yield* fileSystem.readFileString(WORDMARK_SVG_FILE)

      expect(outlineWordmark(font)).toBe(committed)
    }),
  )
})

describe('inkWordmark', () => {
  it('recolours the outline for the dark splash', () => {
    expect(inkWordmark('<path fill="#201711" d="M0 0"/>', DARK_INK)).toBe(
      '<path fill="#EEEBE4" d="M0 0"/>',
    )
  })
})

describe('scopeLightSplashLinks', () => {
  it('scopes light startup images to the light scheme and leaves dark ones alone', () => {
    expect(scopeLightSplashLinks(`${LIGHT_LINK}\n${DARK_LINK}`)).toBe(
      `${SCOPED_LIGHT_LINK}\n${DARK_LINK}`,
    )
  })

  it('does not scope a link twice', () => {
    expect(scopeLightSplashLinks(SCOPED_LIGHT_LINK)).toBe(SCOPED_LIGHT_LINK)
  })
})
