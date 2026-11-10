import * as BunFileSystem from '@effect/platform-bun/BunFileSystem'
import * as BunRuntime from '@effect/platform-bun/BunRuntime'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'

import { MACHINE_CHARTS } from './Charts.ts'

const generate = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem

  yield* Effect.forEach(
    MACHINE_CHARTS,
    ({ file, chart }) =>
      Effect.andThen(
        fileSystem.writeFileString(`charts/${file}`, chart()),
        Effect.logInfo(`Wrote charts/${file}`),
      ),
    { discard: true },
  )
})

// oxlint-disable-next-line effecttsgo/strict-effect-provide
BunRuntime.runMain(generate.pipe(Effect.provide(BunFileSystem.layer)))
