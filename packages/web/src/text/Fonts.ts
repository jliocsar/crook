import * as Effect from 'effect/Effect'
import * as Schema from 'effect/Schema'

export const APP_FONTS: readonly string[] = [
  '1em "Schibsted Grotesk Variable"',
  '1em "Bricolage Grotesque Variable"',
  '1em "Geist Mono Variable"',
]

export class FontLoadFailed extends Schema.TaggedError<FontLoadFailed>()('FontLoadFailed', {
  font: Schema.String,
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `The browser could not load the font ${this.font}, so crook shows a fallback font until the text that needs it asks again. Check that the build serves its font files.`
  }
}

const loadFont = (font: string) =>
  Effect.tryPromise({
    try: () => document.fonts.load(font),
    catch: (cause) => new FontLoadFailed({ font, cause }),
  }).pipe(Effect.catchTag('FontLoadFailed', (error) => Effect.logWarning(error.message)))

export const loadFontsEarly = Effect.forEach(APP_FONTS, loadFont, {
  concurrency: 'unbounded',
  discard: true,
}).pipe(Effect.withSpan('Fonts.loadFontsEarly'))
