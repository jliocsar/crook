import * as BunFileSystem from '@effect/platform-bun/BunFileSystem'
import * as BunRuntime from '@effect/platform-bun/BunRuntime'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'

import { WORDMARK_FONT_FILE, WORDMARK_SVG_FILE } from './Brand.ts'
import { decodeWordmarkFont, outlineWordmark } from './OutlineWordmark.ts'

const generate = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem
  const woff2 = yield* fileSystem.readFile(WORDMARK_FONT_FILE)
  const font = yield* decodeWordmarkFont(woff2)
  yield* fileSystem.writeFileString(WORDMARK_SVG_FILE, outlineWordmark(font))
  yield* Effect.logInfo(`Wrote ${WORDMARK_SVG_FILE}`)
})

// oxlint-disable-next-line effecttsgo/strict-effect-provide
BunRuntime.runMain(generate.pipe(Effect.provide(BunFileSystem.layer)))
