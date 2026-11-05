import * as BunFileSystem from '@effect/platform-bun/BunFileSystem'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as Schema from 'effect/Schema'
import * as Stream from 'effect/Stream'

import { FileWatch } from '@crook/claude/FileWatch'
import { HookPayload } from '@crook/claude/HookPayload'
import { LastTurn } from '@crook/claude/LastTurn'
import { SessionScans } from '@crook/claude/SessionScans'
import { SubagentRoster } from '@crook/claude/SubagentRoster'
import { TranscriptFile } from '@crook/claude/TranscriptLocator'
import { TranscriptTail, messagesIn } from '@crook/claude/TranscriptTail'
import { ClaudeSessionId, TranscriptOffset } from '@crook/domain/Ids'
import { TranscriptMessage } from '@crook/domain/TranscriptMessage'

export const FIXTURES = `${import.meta.dirname}/fixtures`
export const SUBAGENT_FIXTURE_SESSION = 'ff0f77be-1e98-4bb2-8b24-38d673361867'
export const SESSION = ClaudeSessionId.make('309f44d5-235f-4550-a0c7-1691715aad75')
export const START = TranscriptOffset.make(0)
export const SLOWEST_MEASURED_WATCH_INSTALL = Duration.millis(8)
export const WATCHERS_SETTLED = Duration.times(SLOWEST_MEASURED_WATCH_INSTALL, 10)

export const platform = Layer.mergeAll(BunFileSystem.layer, Path.layer)

export const watchedPlatform = Layer.provideMerge(FileWatch.layer, platform)

const transcriptTail = Layer.provideMerge(TranscriptTail.layer, watchedPlatform)

const sessionScans = Layer.provideMerge(SessionScans.layer, transcriptTail)

export const services = Layer.provideMerge(
  Layer.mergeAll(SubagentRoster.layer, LastTurn.layer),
  sessionScans,
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

const SpikeHookRecord = Schema.fromJsonString(
  Schema.Struct({ phase: Schema.String, payload: Schema.optionalKey(Schema.Unknown) }),
)

const decodeHookPayload = Schema.decodeUnknownOption(HookPayload)

export const spikeHooks = Effect.fn('spikeHooks')(function* (name: string) {
  const text = yield* fixtureText(`spike-80/hooks/${name}.hooks.jsonl`)

  return text
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => Schema.decodeSync(SpikeHookRecord)(line))
    .filter((record) => record.phase === 'start')
    .flatMap((record) => Option.toArray(decodeHookPayload(record.payload)))
})

export const spikeTranscriptLines = Effect.fn('spikeTranscriptLines')(function* (
  name: string,
  lineCount: number,
) {
  const text = yield* fixtureText(`spike-80/transcripts/${name}.transcript.jsonl`)
  const lines = text
    .split('\n')
    .filter((line) => line.length > 0)
    .slice(0, lineCount)
    .map((line) => `${line}\n`)

  return lines.join('')
})

export const spikeTranscript = Effect.fn('spikeTranscript')(function* (
  name: string,
  lineCount: number,
) {
  const text = yield* spikeTranscriptLines(name, lineCount)

  return messagesIn(new TextEncoder().encode(text), START)
})
