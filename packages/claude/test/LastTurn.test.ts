import { expect, layer } from '@effect/vitest'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Option from 'effect/Option'

import { LastTurn, firstUnmatchedToolUse } from '@crook/claude/LastTurn'
import { TranscriptFile } from '@crook/claude/TranscriptLocator'

import { SESSION, services, spikeTranscriptLines } from './Fixtures'

const writtenTranscript = Effect.fn('writtenTranscript')(function* (content: string) {
  const fileSystem = yield* FileSystem.FileSystem
  const directory = yield* fileSystem.makeTempDirectoryScoped()
  const path = `${directory}/${SESSION}.jsonl`

  yield* fileSystem.writeFileString(path, content)

  return new TranscriptFile({ session: SESSION, path })
})

layer(services, { excludeTestServices: true })('LastTurn', (it) => {
  it.effect('reads the latest turn of a transcript on disk, from its prompt on', () =>
    Effect.gen(function* () {
      const lastTurn = yield* LastTurn
      const file = yield* writtenTranscript(
        yield* spikeTranscriptLines('native-parallel-bash-approve-then-esc', 3),
      )
      const turn = yield* lastTurn.read(file)

      expect(turn).toHaveLength(2)
      expect(Option.map(firstUnmatchedToolUse(turn), (toolUse) => toolUse.name)).toEqual(
        Option.some('Bash'),
      )
    }).pipe(Effect.scoped),
  )

  it.effect('has nothing pending once a new prompt starts a turn', () =>
    Effect.gen(function* () {
      const lastTurn = yield* LastTurn
      const file = yield* writtenTranscript(
        yield* spikeTranscriptLines('native-parallel-bash-approve-then-esc', 8),
      )

      expect(firstUnmatchedToolUse(yield* lastTurn.read(file))).toEqual(Option.none())
    }).pipe(Effect.scoped),
  )

  it.effect('reads an empty transcript as no turn at all', () =>
    Effect.gen(function* () {
      const lastTurn = yield* LastTurn

      expect(yield* lastTurn.read(yield* writtenTranscript(''))).toEqual([])
    }).pipe(Effect.scoped),
  )
})
