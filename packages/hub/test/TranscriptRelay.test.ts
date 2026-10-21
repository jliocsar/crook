import { expect, layer } from '@effect/vitest'
import * as Arr from 'effect/Array'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import { pipe } from 'effect/Function'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Queue from 'effect/Queue'
import * as Stream from 'effect/Stream'

import { ClaudeSessionId, MachineId, PaneId, TranscriptOffset } from '@crook/domain/Ids'
import {
  PaneTranscript,
  TranscriptChunk,
  type TranscriptEvent,
  TranscriptOpened,
  TranscriptPosition,
  type TranscriptSource,
  TranscriptTailBytes,
} from '@crook/domain/Transcript'
import { UnrecognizedEntry } from '@crook/domain/TranscriptMessage'
import { TranscriptRelay } from '@crook/hub/TranscriptRelay'
import {
  TranscriptOutOfStep,
  TranscriptReadFailed,
  TranscriptWatchFailed,
  type TranscriptWatchId,
} from '@crook/protocol/Transcripts'

const LAPTOP = MachineId.make('laptop')
const DESKTOP = MachineId.make('desktop')
const PANE = PaneId.make('w1:p1')
const SESSION = ClaudeSessionId.make('309f44d5-235f-4550-a0c7-1691715aad75')

const paneSource = new PaneTranscript({ pane: PANE })

const at = (offset: number) =>
  new TranscriptPosition({ session: SESSION, offset: TranscriptOffset.make(offset) })

const chunkBetween = (offset: number, nextOffset: number) =>
  new TranscriptChunk({
    session: SESSION,
    offset: TranscriptOffset.make(offset),
    nextOffset: TranscriptOffset.make(nextOffset),
    messages: [
      new UnrecognizedEntry({ offset: TranscriptOffset.make(offset), entryType: 'future' }),
    ],
  })

const opened = new TranscriptOpened({ session: SESSION })

const describeEvent = (event: TranscriptEvent) =>
  Match.value(event).pipe(
    Match.tagsExhaustive({
      TranscriptOpened: (openedEvent) => `opened ${openedEvent.session}`,
      TranscriptChunk: (chunk) =>
        `chunk ${chunk.offset}-${chunk.nextOffset} ${chunk.messages.length}`,
      SubagentsChanged: (changed) => `subagents ${changed.subagents.length}`,
    }),
  )

const relay = Effect.map(Layer.build(TranscriptRelay.layer), (context) =>
  Context.get(context, TranscriptRelay),
)

const watchIds = (transcripts: TranscriptRelay['Service'], machine: MachineId, count: number) =>
  transcripts.demands(machine).pipe(
    Stream.filter((demand) => demand.watches.length === count),
    Stream.runHead,
    Effect.map((demand) =>
      pipe(
        Option.getOrElse(demand, () => ({ watches: [] })).watches,
        Arr.map((watch) => watch.id),
      ),
    ),
  )

const watching = Effect.fn('watching')(function* (
  transcripts: TranscriptRelay['Service'],
  source: TranscriptSource,
  from: Option.Option<TranscriptPosition>,
) {
  const events = yield* Queue.unbounded<string>()

  yield* transcripts.watch(LAPTOP, source, from, Option.none()).pipe(
    Stream.runForEach((event) => Queue.offer(events, describeEvent(event))),
    Effect.catchTags({
      TranscriptReadFailed: (failure) => Queue.offer(events, `failed ${failure.message}`),
      TranscriptResumeRejected: (failure) => Queue.offer(events, `failed ${failure.message}`),
      TranscriptSessionRejected: (failure) => Queue.offer(events, `failed ${failure.message}`),
    }),
    Effect.forkScoped,
  )

  return events
})

const onlyWatch = (ids: readonly TranscriptWatchId[]) => Effect.fromOption(Arr.head(ids))
layer(Layer.empty)('TranscriptRelay', (it) => {
  it.effect('asks the agent of the watched machine only, from where the phone left off', () =>
    Effect.gen(function* () {
      const transcripts = yield* relay

      yield* watching(transcripts, paneSource, Option.some(at(120)))
      const ids = yield* watchIds(transcripts, LAPTOP, 1)
      const demand = yield* transcripts.demands(LAPTOP).pipe(Stream.runHead)
      const elsewhere = yield* transcripts.demands(DESKTOP).pipe(Stream.runHead)

      expect(
        Option.map(demand, (current) =>
          current.watches.map((watch) => ({ id: watch.id, from: watch.from })),
        ),
      ).toEqual(Option.some([{ id: ids[0], from: Option.some(at(120)) }]))
      expect(Option.map(elsewhere, (current) => current.watches)).toEqual(Option.some([]))
    }),
  )

  it.effect('hands the agent the tail a fresh watch asked for', () =>
    Effect.gen(function* () {
      const transcripts = yield* relay
      const tail = Option.some(TranscriptTailBytes.make(1))

      yield* transcripts
        .watch(LAPTOP, paneSource, Option.none(), tail)
        .pipe(Stream.runDrain, Effect.ignore, Effect.forkScoped)
      yield* watchIds(transcripts, LAPTOP, 1)
      const demand = yield* transcripts.demands(LAPTOP).pipe(Stream.runHead)

      expect(Option.map(demand, (current) => current.watches.map((watch) => watch.tail))).toEqual(
        Option.some([tail]),
      )
    }),
  )

  it.effect('passes on chunks that continue the stream and refuses the rest', () =>
    Effect.gen(function* () {
      const transcripts = yield* relay
      const events = yield* watching(transcripts, paneSource, Option.none())
      const id = yield* onlyWatch(yield* watchIds(transcripts, LAPTOP, 1))

      const early = yield* transcripts.publish(LAPTOP, id, chunkBetween(0, 10)).pipe(Effect.flip)

      yield* transcripts.publish(LAPTOP, id, opened)
      yield* transcripts.publish(LAPTOP, id, chunkBetween(0, 10))
      const skipped = yield* transcripts.publish(LAPTOP, id, chunkBetween(20, 30)).pipe(Effect.flip)

      yield* transcripts.publish(LAPTOP, id, opened)
      yield* transcripts.publish(LAPTOP, id, chunkBetween(10, 20))

      expect(early).toEqual(new TranscriptOutOfStep({ watch: id, expected: Option.none() }))
      expect(skipped).toEqual(new TranscriptOutOfStep({ watch: id, expected: Option.some(at(10)) }))
      expect(
        yield* Effect.forEach(
          Arr.makeBy(3, () => events),
          Queue.take,
        ),
      ).toEqual([`opened ${SESSION}`, 'chunk 0-10 1', 'chunk 10-20 1'])
    }),
  )

  it.effect('keeps the position a phone resumed from, and a later demand carries it', () =>
    Effect.gen(function* () {
      const transcripts = yield* relay
      const events = yield* watching(transcripts, paneSource, Option.some(at(10)))
      const id = yield* onlyWatch(yield* watchIds(transcripts, LAPTOP, 1))

      yield* transcripts.publish(LAPTOP, id, opened)
      yield* transcripts.publish(LAPTOP, id, chunkBetween(10, 20))
      const demand = yield* transcripts.demands(LAPTOP).pipe(Stream.runHead)

      expect(yield* Queue.take(events)).toBe('chunk 10-20 1')
      expect(Option.map(demand, (current) => current.watches.map((watch) => watch.from))).toEqual(
        Option.some([Option.some(at(20))]),
      )
    }),
  )

  it.effect('drops what another machine publishes for a watch it does not own', () =>
    Effect.gen(function* () {
      const transcripts = yield* relay
      const events = yield* watching(transcripts, paneSource, Option.none())
      const id = yield* onlyWatch(yield* watchIds(transcripts, LAPTOP, 1))

      yield* transcripts.publish(DESKTOP, id, opened)
      yield* transcripts.publish(LAPTOP, id, opened)

      expect(yield* Queue.take(events)).toBe(`opened ${SESSION}`)
      expect(yield* Queue.size(events)).toBe(0)
    }),
  )

  it.effect('delivers what came before a failure, then ends the watch with it', () =>
    Effect.gen(function* () {
      const transcripts = yield* relay
      const events = yield* watching(transcripts, paneSource, Option.none())
      const id = yield* onlyWatch(yield* watchIds(transcripts, LAPTOP, 1))
      const failure = new TranscriptReadFailed({ detail: 'permission denied' })

      yield* transcripts.publish(LAPTOP, id, opened)
      yield* transcripts.publish(LAPTOP, id, new TranscriptWatchFailed({ failure }))

      expect(
        yield* Effect.forEach(
          Arr.makeBy(2, () => events),
          Queue.take,
        ),
      ).toEqual([`opened ${SESSION}`, `failed ${failure.message}`])
      expect(yield* watchIds(transcripts, LAPTOP, 0)).toEqual([])
    }),
  )
})
