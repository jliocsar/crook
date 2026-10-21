import * as BunFileSystem from '@effect/platform-bun/BunFileSystem'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Path from 'effect/Path'
import * as Schema from 'effect/Schema'
import * as Stream from 'effect/Stream'

import { SubagentRoster } from '@crook/claude/SubagentRoster'
import { TranscriptFile } from '@crook/claude/TranscriptLocator'
import { TranscriptTail } from '@crook/claude/TranscriptTail'
import { ClaudeSessionId, TranscriptOffset } from '@crook/domain/Ids'
import { TranscriptMessage } from '@crook/domain/TranscriptMessage'

export const FIXTURES = `${import.meta.dirname}/fixtures`
export const SUBAGENT_FIXTURE_SESSION = 'ff0f77be-1e98-4bb2-8b24-38d673361867'
export const SESSION = ClaudeSessionId.make('309f44d5-235f-4550-a0c7-1691715aad75')
export const START = TranscriptOffset.make(0)
export const SLOWEST_MEASURED_WATCH_INSTALL = Duration.millis(8)
export const WATCHERS_SETTLED = Duration.times(SLOWEST_MEASURED_WATCH_INSTALL, 10)

export const platform = Layer.mergeAll(BunFileSystem.layer, Path.layer)

export const services = Layer.provideMerge(
  Layer.mergeAll(TranscriptTail.layer, SubagentRoster.layer),
  platform,
)

export const encodeMessages = Schema.encodeSync(Schema.Array(TranscriptMessage))

export const fixtureFile = (name: string) =>
  new TranscriptFile({ session: SESSION, path: `${FIXTURES}/${name}` })

export const drained = Effect.fn('drained')(function* (file: TranscriptFile) {
  const tail = yield* TranscriptTail

  return yield* tail.drain(file, START).pipe(Stream.runCollect)
})

export const messagesOf = Effect.fn('messagesOf')(function* (name: string) {
  const chunks = yield* drained(fixtureFile(name))

  return encodeMessages(chunks.flatMap((chunk) => chunk.messages))
})

export const fixtureText = Effect.fn('fixtureText')(function* (name: string) {
  const fileSystem = yield* FileSystem.FileSystem

  return yield* fileSystem.readFileString(`${FIXTURES}/${name}`)
})
