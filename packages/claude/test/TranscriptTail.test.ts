import { expect, layer } from '@effect/vitest'
import * as Arr from 'effect/Array'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import { pipe } from 'effect/Function'
import * as Option from 'effect/Option'
import * as Queue from 'effect/Queue'
import * as Stream from 'effect/Stream'

import { TranscriptFile } from '@crook/claude/TranscriptLocator'
import {
  TranscriptOffsetBeyondEnd,
  TranscriptOffsetMidLine,
  TranscriptShrank,
  TranscriptTail,
} from '@crook/claude/TranscriptTail'
import { TranscriptOffset } from '@crook/domain/Ids'
import type { TranscriptChunk } from '@crook/domain/Transcript'

import {
  FIXTURES,
  SESSION,
  START,
  drained,
  encodeMessages,
  fixtureFile,
  services,
} from './Fixtures'

const PAGE = 4096
const LARGE_APPEND = 120 * 1024

const encoder = new TextEncoder()

const messagesIn = (chunks: readonly TranscriptChunk[]) =>
  encodeMessages(chunks.flatMap((chunk) => chunk.messages))

const scratchFile = Effect.fn('scratchFile')(function* (content: Uint8Array) {
  const fileSystem = yield* FileSystem.FileSystem
  const directory = yield* fileSystem.makeTempDirectoryScoped()
  const path = `${directory}/${SESSION}.jsonl`

  yield* fileSystem.writeFile(path, content)

  return new TranscriptFile({ session: SESSION, path })
})

const append = Effect.fn('append')(function* (file: TranscriptFile, content: Uint8Array) {
  const fileSystem = yield* FileSystem.FileSystem

  yield* fileSystem.writeFile(file.path, content, { flag: 'a' })
})

const following = Effect.fn('following')(function* (file: TranscriptFile, from: TranscriptOffset) {
  const tail = yield* TranscriptTail
  const chunks = yield* Queue.unbounded<TranscriptChunk>()

  yield* tail.follow(file, from).pipe(
    Stream.runForEach((chunk) => Queue.offer(chunks, chunk)),
    Effect.forkScoped,
  )

  return chunks
})

const takeUntilOffset = (
  chunks: Queue.Queue<TranscriptChunk>,
  offset: number,
): Effect.Effect<readonly TranscriptChunk[]> =>
  Effect.flatMap(Queue.take(chunks), (chunk) =>
    chunk.nextOffset >= offset
      ? Effect.succeed([chunk])
      : Effect.map(takeUntilOffset(chunks, offset), (rest) => [chunk, ...rest]),
  )

const fixtureBytes = Effect.fn('fixtureBytes')(function* (name: string) {
  const fileSystem = yield* FileSystem.FileSystem

  return yield* fileSystem.readFile(`${FIXTURES}/${name}`)
})

layer(services, { excludeTestServices: true })('TranscriptTail', (live) => {
  live.effect('holds back a line cut at a 4096-byte page and emits it once the rest lands', () =>
    Effect.gen(function* () {
      const whole = yield* fixtureBytes('plain-turn.jsonl')
      const expected = messagesIn(yield* drained(fixtureFile('plain-turn.jsonl')))
      const lastNewlineInPage = whole.subarray(0, PAGE).lastIndexOf(0x0a) + 1
      const file = yield* scratchFile(whole.subarray(0, PAGE))
      const chunks = yield* following(file, START)
      const first = yield* takeUntilOffset(chunks, lastNewlineInPage)

      yield* append(file, whole.subarray(PAGE))
      const rest = yield* takeUntilOffset(chunks, whole.length)

      expect(Arr.map(first, (chunk) => chunk.nextOffset)).toEqual([lastNewlineInPage])
      expect(rest[0]?.offset).toBe(lastNewlineInPage)
      expect(messagesIn([...first, ...rest])).toEqual(expected)
    }),
  )

  live.effect('delivers an append over 120 KB written at once, in line-aligned chunks', () =>
    Effect.gen(function* () {
      const turn = yield* fixtureBytes('tool-use-and-result.jsonl')
      const copies = Math.ceil(LARGE_APPEND / turn.length) + 1
      const appended = new Uint8Array(turn.length * copies)

      Arr.makeBy(copies, (copy) => appended.set(turn, copy * turn.length))
      const file = yield* scratchFile(new Uint8Array(0))
      const chunks = yield* following(file, START)

      yield* append(file, appended)
      const received = yield* takeUntilOffset(chunks, appended.length)
      const toolCalls = messagesIn(received).filter((message) =>
        JSON.stringify(message).includes('"ToolUse"'),
      )

      expect(appended.length).toBeGreaterThan(LARGE_APPEND)
      expect(toolCalls).toHaveLength(3 * copies)
      expect(
        Arr.every(
          received,
          (chunk, index) => index === 0 || received[index - 1]?.nextOffset === chunk.offset,
        ),
      ).toBe(true)
      expect(Arr.every(received, (chunk) => appended[chunk.nextOffset - 1] === 0x0a)).toBe(true)
    }),
  )

  live.effect('resumes after a line offset it handed out, and nowhere else', () =>
    Effect.gen(function* () {
      const tail = yield* TranscriptTail
      const file = fixtureFile('plain-turn.jsonl')
      const whole = yield* drained(file)
      const resumeAt = TranscriptOffset.make(20016)
      const resumed = yield* tail.drain(file, resumeAt).pipe(Stream.runCollect)
      const midLine = yield* tail
        .drain(file, TranscriptOffset.make(20017))
        .pipe(Stream.runCollect, Effect.flip)
      const beyond = yield* tail
        .drain(file, TranscriptOffset.make(10 ** 9))
        .pipe(Stream.runCollect, Effect.flip)

      expect(messagesIn(resumed)).toEqual(
        messagesIn(whole).filter((message) => message.offset >= resumeAt),
      )
      expect(midLine).toEqual(new TranscriptOffsetMidLine({ path: file.path, offset: 20017 }))
      expect(beyond).toBeInstanceOf(TranscriptOffsetBeyondEnd)
    }),
  )

  live.effect('never emits a final line that never completes', () =>
    Effect.gen(function* () {
      const chunks = yield* drained(fixtureFile('truncated-final-line.jsonl'))
      const size = (yield* fixtureBytes('truncated-final-line.jsonl')).length

      expect(Arr.last(chunks).pipe(Option.map((chunk) => chunk.nextOffset))).toEqual(
        Option.some(2652),
      )
      expect(size).toBeGreaterThan(2652)
      expect(messagesIn(chunks)).toMatchObject([{ _tag: 'Assistant', offset: 641 }])
    }),
  )

  live.effect('fails when the file shrinks under it', () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const tail = yield* TranscriptTail
      const whole = yield* fixtureBytes('plain-turn.jsonl')
      const file = yield* scratchFile(whole)
      const failure = yield* pipe(
        tail.follow(file, START),
        Stream.tap((chunk) =>
          chunk.nextOffset === whole.length
            ? Effect.andThen(
                fileSystem.truncate(file.path, 10),
                append(file, encoder.encode('{}\n')),
              )
            : Effect.void,
        ),
        Stream.runDrain,
        Effect.flip,
      )

      expect(failure).toEqual(
        new TranscriptShrank({ path: file.path, consumed: whole.length, size: 13 }),
      )
    }),
  )
})
