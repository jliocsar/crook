import { expect, layer } from '@effect/vitest'
import * as Arr from 'effect/Array'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import { pipe } from 'effect/Function'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Queue from 'effect/Queue'
import * as Schema from 'effect/Schema'
import * as Stream from 'effect/Stream'

import { FileWatch } from '@crook/claude/FileWatch'
import { TranscriptFile } from '@crook/claude/TranscriptLocator'
import {
  NEWLINE,
  TranscriptOffsetBeyondEnd,
  TranscriptOffsetMidLine,
  TAIL_READ_SIZE,
  TranscriptShrank,
  TranscriptTail,
  type TailEvent,
} from '@crook/claude/TranscriptTail'
import { TranscriptOffset } from '@crook/domain/Ids'
import {
  CHUNK_READ_LIMIT,
  TranscriptCaughtUp,
  TranscriptChunk,
  TranscriptTailBytes,
} from '@crook/domain/Transcript'

import {
  FIXTURES,
  SESSION,
  START,
  WATCHERS_SETTLED,
  drained,
  encodeMessages,
  fixtureFile,
  services,
} from './Fixtures'

const PAGE = 4096
const LARGE_APPEND = 120 * 1024
const LONG_LINE = 3 * TAIL_READ_SIZE

const encoder = new TextEncoder()

const isChunk = Schema.is(TranscriptChunk)

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
    Stream.filter(isChunk),
    Stream.runForEach((chunk) => Queue.offer(chunks, chunk)),
    Effect.forkScoped,
  )

  return chunks
})

const followingAll = Effect.fn('followingAll')(function* (
  file: TranscriptFile,
  from: TranscriptOffset,
) {
  const tail = yield* TranscriptTail
  const events = yield* Queue.unbounded<TailEvent>()

  yield* tail.follow(file, from).pipe(
    Stream.runForEach((event) => Queue.offer(events, event)),
    Effect.forkScoped,
  )

  return events
})

const takeThroughCaughtUp = (events: Queue.Queue<TailEvent>): Effect.Effect<readonly TailEvent[]> =>
  Effect.flatMap(Queue.take(events), (event) =>
    isChunk(event)
      ? Effect.map(takeThroughCaughtUp(events), (rest) => [event, ...rest])
      : Effect.succeed([event]),
  )

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

const repeatedPast = (turn: Uint8Array, minimum: number) => {
  const copies = Math.ceil(minimum / turn.length) + 1
  const repeated = new Uint8Array(turn.length * copies)

  Arr.makeBy(copies, (copy) => repeated.set(turn, copy * turn.length))

  return repeated
}

layer(services, { excludeTestServices: true })('TranscriptTail', (live) => {
  live.effect(
    'reads what a lost event left behind on the next wake, and sends nothing when no more is there',
    () =>
      Effect.gen(function* () {
        const first = encoder.encode('{}\n')
        const second = encoder.encode('{"a":1}\n')
        const third = encoder.encode('{"a":2}\n')
        const file = yield* scratchFile(first)
        const wakes = yield* Queue.unbounded<Option.Option<string>>()
        const context = yield* Layer.build(
          Layer.provide(
            TranscriptTail.layer,
            Layer.mock(FileWatch, { watchReady: () => Stream.fromQueue(wakes) }),
          ),
        )
        const tail = Context.get(context, TranscriptTail)
        const events = yield* Queue.unbounded<TailEvent>()
        const offsetsOf = (chunk: TailEvent) =>
          isChunk(chunk) ? [chunk.offset, chunk.nextOffset] : []

        yield* tail.follow(file, START).pipe(
          Stream.runForEach((event) => Queue.offer(events, event)),
          Effect.forkScoped,
        )
        yield* Queue.offer(wakes, Option.none())

        expect((yield* takeThroughCaughtUp(events)).flatMap(offsetsOf)).toEqual([0, first.length])

        yield* append(file, second)
        yield* Queue.offer(wakes, Option.some(SESSION))

        const afterFirst = first.length + second.length

        expect(offsetsOf(yield* Queue.take(events))).toEqual([first.length, afterFirst])

        yield* Queue.offer(wakes, Option.some(SESSION))
        yield* Effect.sleep(WATCHERS_SETTLED)

        expect(yield* Queue.size(events)).toBe(0)

        yield* append(file, third)
        yield* Queue.offer(wakes, Option.some(SESSION))

        expect(offsetsOf(yield* Queue.take(events))).toEqual([
          afterFirst,
          afterFirst + third.length,
        ])
      }),
  )

  live.effect('holds back a line cut at a 4096-byte page and emits it once the rest lands', () =>
    Effect.gen(function* () {
      const whole = yield* fixtureBytes('plain-turn.jsonl')
      const expected = messagesIn(yield* drained(fixtureFile('plain-turn.jsonl')))
      const lastNewlineInPage = whole.subarray(0, PAGE).lastIndexOf(NEWLINE) + 1
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
      expect(Arr.every(received, (chunk) => appended[chunk.nextOffset - 1] === NEWLINE)).toBe(true)
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

  live.effect('starts a tail at the line that holds the byte it was asked for', () =>
    Effect.gen(function* () {
      const tail = yield* TranscriptTail
      const file = fixtureFile('plain-turn.jsonl')
      const whole = yield* fixtureBytes('plain-turn.jsonl')
      const bytes = TranscriptTailBytes.make(Math.floor(whole.length / 2))
      const start = yield* tail.tailStart(file, START, bytes)
      const resumed = yield* tail.drain(file, start).pipe(Stream.runCollect)
      const everything = yield* tail.tailStart(
        file,
        START,
        TranscriptTailBytes.make(whole.length + 1),
      )
      const expected = messagesIn(yield* drained(file)).filter((message) => message.offset >= start)

      expect(start).toBeGreaterThan(0)
      expect(start).toBeLessThanOrEqual(whole.length - bytes)
      expect(whole[start - 1]).toBe(NEWLINE)
      expect(whole.subarray(start, whole.length - bytes).includes(NEWLINE)).toBe(false)
      expect(messagesIn(resumed)).toEqual(expected)
      expect(everything).toBe(START)
    }),
  )

  live.effect('walks back past a read window to find the start of a long line', () =>
    Effect.gen(function* () {
      const tail = yield* TranscriptTail
      const first = encoder.encode('{"type":"first"}\n')
      const long = encoder.encode(`{"type":"${'x'.repeat(LONG_LINE)}"}\n`)
      const content = new Uint8Array(first.length + long.length)

      content.set(first)
      content.set(long, first.length)
      const file = yield* scratchFile(content)
      const start = yield* tail.tailStart(file, START, TranscriptTailBytes.make(TAIL_READ_SIZE))

      expect(start).toBe(first.length)
    }),
  )

  live.effect('keeps a resume where it is while one read covers what it has not seen', () =>
    Effect.gen(function* () {
      const tail = yield* TranscriptTail
      const seen = encoder.encode('{"type":"seen"}\n')
      const missed = encoder.encode(`{"type":"${'x'.repeat(CHUNK_READ_LIMIT - 20)}"}\n`)
      const content = new Uint8Array(seen.length + missed.length)

      content.set(seen)
      content.set(missed, seen.length)
      const file = yield* scratchFile(content)
      const from = TranscriptOffset.make(seen.length)
      const start = yield* tail.tailStart(file, from, TranscriptTailBytes.make(TAIL_READ_SIZE))

      expect(missed.length).toBeLessThanOrEqual(CHUNK_READ_LIMIT)
      expect(start).toBe(from)
    }),
  )

  live.effect('moves a resume to the tail once one read cannot cover what it has not seen', () =>
    Effect.gen(function* () {
      const tail = yield* TranscriptTail
      const seen = encoder.encode('{"type":"seen"}\n')
      const missed = encoder.encode(`{"type":"${'x'.repeat(CHUNK_READ_LIMIT)}"}\n`)
      const recent = encoder.encode('{"type":"recent"}\n')
      const content = new Uint8Array(seen.length + missed.length + recent.length)

      content.set(seen)
      content.set(missed, seen.length)
      content.set(recent, seen.length + missed.length)
      const file = yield* scratchFile(content)
      const start = yield* tail.tailStart(
        file,
        TranscriptOffset.make(seen.length),
        TranscriptTailBytes.make(recent.length),
      )

      expect(start).toBe(seen.length + missed.length)
    }),
  )

  live.effect('refuses to skip from an offset that is not a line of this file', () =>
    Effect.gen(function* () {
      const tail = yield* TranscriptTail
      const seen = encoder.encode('{"type":"seen"}\n')
      const missed = encoder.encode(`{"type":"${'x'.repeat(CHUNK_READ_LIMIT)}"}\n`)
      const content = new Uint8Array(seen.length + missed.length)

      content.set(seen)
      content.set(missed, seen.length)
      const file = yield* scratchFile(content)
      const bytes = TranscriptTailBytes.make(TAIL_READ_SIZE)
      const midLine = TranscriptOffset.make(seen.length + 1)
      const beyond = TranscriptOffset.make(content.length + 1)

      expect(yield* Effect.flip(tail.tailStart(file, midLine, bytes))).toEqual(
        new TranscriptOffsetMidLine({ path: file.path, offset: midLine }),
      )
      expect(yield* Effect.flip(tail.tailStart(file, beyond, bytes))).toBeInstanceOf(
        TranscriptOffsetBeyondEnd,
      )
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

  live.effect(
    'announces it caught up once the backlog is read, and only then streams what is appended',
    () =>
      Effect.gen(function* () {
        const turn = yield* fixtureBytes('tool-use-and-result.jsonl')
        const backlog = repeatedPast(turn, CHUNK_READ_LIMIT)
        const file = yield* scratchFile(backlog)
        const events = yield* followingAll(file, START)
        const throughCaughtUp = yield* takeThroughCaughtUp(events)

        yield* append(file, turn)
        const afterCaughtUp = yield* Queue.take(events)
        const backlogChunks = Arr.filter(throughCaughtUp, isChunk)

        expect(backlog.length).toBeGreaterThan(CHUNK_READ_LIMIT)
        expect(backlogChunks.length).toBeGreaterThan(1)
        expect(Arr.last(throughCaughtUp)).toEqual(
          Option.some(
            new TranscriptCaughtUp({
              session: SESSION,
              offset: TranscriptOffset.make(backlog.length),
            }),
          ),
        )
        expect(Arr.last(backlogChunks).pipe(Option.map((chunk) => chunk.nextOffset))).toEqual(
          Option.some(backlog.length),
        )
        expect(afterCaughtUp).toMatchObject({
          offset: backlog.length,
          nextOffset: backlog.length + turn.length,
        })
      }),
  )

  live.effect('reads a backlog under the read limit as one chunk', () =>
    Effect.gen(function* () {
      const backlog = repeatedPast(yield* fixtureBytes('tool-use-and-result.jsonl'), LARGE_APPEND)
      const file = yield* scratchFile(backlog)
      const throughCaughtUp = yield* takeThroughCaughtUp(yield* followingAll(file, START))

      expect(backlog.length).toBeGreaterThan(TAIL_READ_SIZE)
      expect(backlog.length).toBeLessThan(CHUNK_READ_LIMIT)
      expect(
        pipe(
          throughCaughtUp,
          Arr.filter(isChunk),
          Arr.map((chunk) => chunk.offset),
        ),
      ).toEqual([0])
      expect(Arr.last(throughCaughtUp)).toEqual(
        Option.some(
          new TranscriptCaughtUp({
            session: SESSION,
            offset: TranscriptOffset.make(backlog.length),
          }),
        ),
      )
    }),
  )

  live.effect('reports a cut last line as not yet caught up to', () =>
    Effect.gen(function* () {
      const whole = yield* fixtureBytes('plain-turn.jsonl')
      const lastNewlineInPage = whole.subarray(0, PAGE).lastIndexOf(NEWLINE) + 1
      const file = yield* scratchFile(whole.subarray(0, PAGE))
      const events = yield* followingAll(file, START)
      const throughCaughtUp = yield* takeThroughCaughtUp(events)

      expect(Arr.last(throughCaughtUp)).toEqual(
        Option.some(
          new TranscriptCaughtUp({
            session: SESSION,
            offset: TranscriptOffset.make(lastNewlineInPage),
          }),
        ),
      )
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
        Stream.tap((event) =>
          isChunk(event) && event.nextOffset === whole.length
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
