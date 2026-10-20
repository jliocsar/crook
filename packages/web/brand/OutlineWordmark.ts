import type * as Fontkit from 'fontkit'

import * as Arr from 'effect/Array'
import * as Effect from 'effect/Effect'
import { pipe } from 'effect/Function'
import * as Schema from 'effect/Schema'
import decompress from 'wawoff2/decompress'
import * as fontkit from 'fontkit'

import {
  LIGHT_INK,
  WORDMARK_BASELINE,
  WORDMARK_BOX,
  WORDMARK_SIZE,
  WORDMARK_TEXT,
  WORDMARK_TRACKING_EM,
  WORDMARK_WEIGHT,
} from './Brand.ts'

export class WordmarkFontUndecodable extends Schema.TaggedError<WordmarkFontUndecodable>()(
  'WordmarkFontUndecodable',
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return 'The wordmark font is not a WOFF2 file wawoff2 can decompress. Check that @fontsource-variable/bricolage-grotesque is installed and still ships its wght subset as WOFF2.'
  }
}

export class WordmarkFontIsCollection extends Schema.TaggedError<WordmarkFontIsCollection>()(
  'WordmarkFontIsCollection',
  {},
) {
  override get message(): string {
    return 'The wordmark font decompressed to a font collection, not a single font. Point WORDMARK_FONT_FILE at a single-font WOFF2.'
  }
}

const isCollection = (
  font: Fontkit.Font | Fontkit.FontCollection,
): font is Fontkit.FontCollection => font.type === 'TTC' || font.type === 'DFont'

export const decodeWordmarkFont = Effect.fn('OutlineWordmark.decodeWordmarkFont')(function* (
  woff2: Uint8Array,
) {
  const sfnt = yield* Effect.tryPromise({
    try: () => decompress(woff2),
    catch: (cause) => new WordmarkFontUndecodable({ cause }),
  })
  const font = fontkit.create(Buffer.from(sfnt))

  if (isCollection(font)) {
    return yield* new WordmarkFontIsCollection()
  }

  return font.getVariation({ wght: WORDMARK_WEIGHT })
})

export const outlineWordmark = (font: Fontkit.Font): string => {
  const run = font.layout(WORDMARK_TEXT)
  const scale = WORDMARK_SIZE / font.unitsPerEm
  const tracking = WORDMARK_TRACKING_EM * font.unitsPerEm
  const advances = Arr.map(run.positions, (position) => position.xAdvance + tracking)
  const width = Arr.reduce(advances, -tracking, (total, advance) => total + advance)
  const start = WORDMARK_BOX / 2 - (width * scale) / 2
  const origins = pipe(
    Arr.scan(advances, 0, (offset, advance) => offset + advance),
    Arr.map((offset) => start + offset * scale),
  )
  const data = pipe(
    Arr.zip(run.glyphs, origins),
    Arr.map(([glyph, origin]) =>
      glyph.path.scale(scale, -scale).translate(origin, WORDMARK_BASELINE).toSVG(),
    ),
    Arr.join(''),
  )

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WORDMARK_BOX} ${WORDMARK_BOX}"><path fill="${LIGHT_INK}" d="${data}"/></svg>\n`
}
