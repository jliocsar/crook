import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'

export const spikeScreen = Effect.fn('spikeScreen')(function* (name: string) {
  const fileSystem = yield* FileSystem.FileSystem

  return yield* fileSystem.readFileString(
    new URL(import.meta.resolve(`@crook/claude/fixtures/spike-80/screens/${name}.txt`)).pathname,
  )
})
