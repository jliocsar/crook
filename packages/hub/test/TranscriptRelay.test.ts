import { expect, layer } from '@effect/vitest'
import * as Arr from 'effect/Array'
import * as Context from 'effect/Context'
import * as Deferred from 'effect/Deferred'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as Fiber from 'effect/Fiber'
import { pipe } from 'effect/Function'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Queue from 'effect/Queue'
import * as Stream from 'effect/Stream'
import * as Tracer from 'effect/Tracer'

import { ClaudeSessionId, MachineId, PaneId, TranscriptOffset } from '@crook/domain/Ids'
import { SkillListing } from '@crook/domain/Skill'
import {
  BackgroundChanged,
  CHUNK_READ_LIMIT,
  PaneTranscript,
  SkillsChanged,
  SubagentsChanged,
  TranscriptCaughtUp,
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
  type TranscriptUpdate,
  TranscriptWatchFailed,
  type TranscriptWatchId,
} from '@crook/protocol/Transcripts'

const LAPTOP = MachineId.make('laptop')
const DESKTOP = MachineId.make('desktop')
const PANE = PaneId.make('w1:p1')
const SESSION = ClaudeSessionId.make('309f44d5-235f-4550-a0c7-1691715aad75')
const NEXT_SESSION = ClaudeSessionId.make('ff0f77be-1e98-4bb2-8b24-38d673361867')
const DEMAND_SPAN = 'TranscriptRelay.demandOf'

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

const skillsOf = (count: number) =>
  new SkillsChanged({
    session: SESSION,
    skills: Arr.makeBy(
      count,
      () =>
        new SkillListing({
          name: 'prototype',
          description: 'Build several versions of a UI piece',
          argumentHint: Option.none(),
          scope: 'project',
        }),
    ),
  })

const describeEvent = (event: TranscriptEvent) =>
  Match.value(event).pipe(
    Match.tagsExhaustive({
      TranscriptOpened: (openedEvent) => `opened ${openedEvent.session}`,
      TranscriptChunk: (chunk) =>
        `chunk ${chunk.offset}-${chunk.nextOffset} ${chunk.messages.length}`,
      SubagentsChanged: (changed) => `subagents ${changed.subagents.length}`,
      SkillsChanged: (changed) => `skills ${changed.skills.length}`,
      BackgroundChanged: (changed) => `background ${changed.tasks.length}`,
      TranscriptCaughtUp: (caughtUp) => `caught up ${caughtUp.offset}`,
    }),
  )

const relay = Effect.gen(function* () {
  const transcripts = Context.get(yield* Layer.build(TranscriptRelay.layer), TranscriptRelay)
  const laptop = yield* transcripts.linkFor(LAPTOP)
  const desktop = yield* transcripts.linkFor(DESKTOP)
  const linkOf = (machine: MachineId) => (machine === LAPTOP ? laptop : desktop)

  return {
    ...transcripts,
    demands: (machine: MachineId) => linkOf(machine).demands,
    publish: (
      machine: MachineId,
      id: TranscriptWatchId,
      updates: Arr.NonEmptyReadonlyArray<TranscriptUpdate>,
    ) => linkOf(machine).publish(id, updates),
  }
})

const watchIds = (transcripts: Effect.Success<typeof relay>, machine: MachineId, count: number) =>
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

const countingSpans = (names: string[]) =>
  Tracer.make({
    span: (options) => {
      names.push(options.name)

      return new Tracer.NativeSpan(options)
    },
  })

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
        .pipe(Stream.runDrain, Effect.ignore({ log: 'Debug' }), Effect.forkScoped)
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

      const early = yield* transcripts.publish(LAPTOP, id, [chunkBetween(0, 10)]).pipe(Effect.flip)

      const delivered = yield* Effect.forEach([opened, chunkBetween(0, 10)], (update) =>
        Effect.andThen(transcripts.publish(LAPTOP, id, [update]), Queue.take(events)),
      )
      const skipped = yield* transcripts
        .publish(LAPTOP, id, [chunkBetween(20, 30)])
        .pipe(Effect.flip)

      yield* transcripts.publish(LAPTOP, id, [opened])
      yield* transcripts.publish(LAPTOP, id, [chunkBetween(10, 20)])

      expect(early).toEqual(new TranscriptOutOfStep({ watch: id, expected: Option.none() }))
      expect(skipped).toEqual(new TranscriptOutOfStep({ watch: id, expected: Option.some(at(10)) }))
      expect(delivered).toEqual([`opened ${SESSION}`, 'chunk 0-10 1'])
      expect(yield* Queue.take(events)).toBe('chunk 10-20 1')
    }),
  )

  it.effect('forwards a batch up to a chunk that is out of step, and refuses the rest', () =>
    Effect.gen(function* () {
      const transcripts = yield* relay
      const events = yield* watching(transcripts, paneSource, Option.none())
      const id = yield* onlyWatch(yield* watchIds(transcripts, LAPTOP, 1))

      const refused = yield* transcripts
        .publish(LAPTOP, id, [
          opened,
          chunkBetween(0, 10),
          chunkBetween(20, 30),
          new TranscriptCaughtUp({ session: SESSION, offset: TranscriptOffset.make(30) }),
        ])
        .pipe(Effect.flip)
      const delivered = yield* Queue.takeN(events, 2)
      const demand = yield* transcripts.demands(LAPTOP).pipe(Stream.runHead)

      expect(refused).toEqual(new TranscriptOutOfStep({ watch: id, expected: Option.some(at(10)) }))
      expect(delivered).toEqual([`opened ${SESSION}`, 'chunk 0-10 1'])
      expect(Option.map(demand, (current) => current.watches.map((watch) => watch.from))).toEqual(
        Option.some([Option.some(at(10))]),
      )
    }),
  )

  it.effect('passes on that the agent caught up, without moving the position', () =>
    Effect.gen(function* () {
      const transcripts = yield* relay
      const events = yield* watching(transcripts, paneSource, Option.none())
      const id = yield* onlyWatch(yield* watchIds(transcripts, LAPTOP, 1))

      const delivered = yield* Effect.forEach(
        [
          opened,
          chunkBetween(0, 10),
          new TranscriptCaughtUp({ session: SESSION, offset: TranscriptOffset.make(10) }),
          chunkBetween(10, 20),
        ],
        (update) => Effect.andThen(transcripts.publish(LAPTOP, id, [update]), Queue.take(events)),
      )

      expect(delivered).toEqual([
        `opened ${SESSION}`,
        'chunk 0-10 1',
        'caught up 10',
        'chunk 10-20 1',
      ])
    }),
  )

  it.effect('passes on the skills of the session it reads, and drops those of another', () =>
    Effect.gen(function* () {
      const transcripts = yield* relay
      const events = yield* watching(transcripts, paneSource, Option.none())
      const id = yield* onlyWatch(yield* watchIds(transcripts, LAPTOP, 1))

      yield* transcripts.publish(LAPTOP, id, [skillsOf(1)])
      const delivered = yield* Effect.forEach(
        [opened, skillsOf(1), chunkBetween(0, 10)],
        (update) => Effect.andThen(transcripts.publish(LAPTOP, id, [update]), Queue.take(events)),
      )

      expect(delivered).toEqual([`opened ${SESSION}`, 'skills 1', 'chunk 0-10 1'])
    }),
  )

  it.effect('merges what the agent sends while the phone still holds the last delivery', () =>
    Effect.gen(function* () {
      const transcripts = yield* relay
      const deliveries = yield* Queue.unbounded<readonly string[]>()
      const acknowledged = yield* Deferred.make<void>()

      yield* transcripts.watch(LAPTOP, paneSource, Option.none(), Option.none()).pipe(
        Stream.runForEachArray((events) =>
          Effect.andThen(
            Queue.offer(deliveries, Arr.map(events, describeEvent)),
            Deferred.await(acknowledged),
          ),
        ),
        Effect.ignore({ log: 'Debug' }),
        Effect.forkScoped,
      )
      const id = yield* onlyWatch(yield* watchIds(transcripts, LAPTOP, 1))

      yield* transcripts.publish(LAPTOP, id, [opened])
      const first = yield* Queue.take(deliveries)

      yield* transcripts.publish(LAPTOP, id, [chunkBetween(0, 10), skillsOf(1)])
      yield* transcripts.publish(LAPTOP, id, [chunkBetween(10, 20)])
      yield* transcripts.publish(LAPTOP, id, [
        new TranscriptCaughtUp({ session: SESSION, offset: TranscriptOffset.make(20) }),
        skillsOf(2),
      ])
      yield* Deferred.succeed(acknowledged, undefined)

      expect(first).toEqual([`opened ${SESSION}`])
      expect(yield* Queue.take(deliveries)).toEqual(['chunk 0-20 2', 'caught up 20', 'skills 2'])
    }),
  )

  it.effect('keeps the position a phone resumed from, and a later demand carries it', () =>
    Effect.gen(function* () {
      const transcripts = yield* relay
      const events = yield* watching(transcripts, paneSource, Option.some(at(10)))
      const id = yield* onlyWatch(yield* watchIds(transcripts, LAPTOP, 1))

      yield* transcripts.publish(LAPTOP, id, [opened])
      const overlapping = yield* transcripts
        .publish(LAPTOP, id, [chunkBetween(5, 20)])
        .pipe(Effect.flip)
      yield* transcripts.publish(LAPTOP, id, [chunkBetween(10, 20)])
      const demand = yield* transcripts.demands(LAPTOP).pipe(Stream.runHead)

      expect(overlapping).toEqual(
        new TranscriptOutOfStep({ watch: id, expected: Option.some(at(10)) }),
      )
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

      yield* transcripts.publish(DESKTOP, id, [opened])
      yield* transcripts.publish(LAPTOP, id, [opened])

      expect(yield* Queue.take(events)).toBe(`opened ${SESSION}`)
      expect(yield* Queue.size(events)).toBe(0)
    }),
  )

  it.effect(
    'delivers what came before a failure, then ends the watch with it and takes no more',
    () =>
      Effect.gen(function* () {
        const transcripts = yield* relay
        const events = yield* watching(transcripts, paneSource, Option.none())
        const id = yield* onlyWatch(yield* watchIds(transcripts, LAPTOP, 1))
        const failure = new TranscriptReadFailed({ detail: 'permission denied' })

        yield* transcripts.publish(LAPTOP, id, [opened])
        yield* transcripts.publish(LAPTOP, id, [
          new TranscriptWatchFailed({ failure }),
          chunkBetween(20, 30),
        ])

        expect(yield* Queue.takeN(events, 2)).toEqual([
          `opened ${SESSION}`,
          `failed ${failure.message}`,
        ])
        expect(yield* watchIds(transcripts, LAPTOP, 0)).toEqual([])
      }),
  )

  it.effect(
    'drops what the phone already has: a repeated open, and the news of a session it left',
    () =>
      Effect.gen(function* () {
        const transcripts = yield* relay
        const events = yield* watching(transcripts, paneSource, Option.none())
        const id = yield* onlyWatch(yield* watchIds(transcripts, LAPTOP, 1))

        yield* transcripts.publish(LAPTOP, id, [opened, chunkBetween(0, 10)])
        const first = yield* Queue.takeN(events, 2)

        yield* transcripts.publish(LAPTOP, id, [
          opened,
          new TranscriptOpened({ session: NEXT_SESSION }),
          new SubagentsChanged({ session: SESSION, subagents: [] }),
          new BackgroundChanged({ session: SESSION, tasks: [], activity: [] }),
          skillsOf(1),
          new TranscriptCaughtUp({ session: SESSION, offset: TranscriptOffset.make(10) }),
          new TranscriptCaughtUp({ session: NEXT_SESSION, offset: TranscriptOffset.make(0) }),
        ])

        expect(first).toEqual([`opened ${SESSION}`, 'chunk 0-10 1'])
        expect(yield* Queue.takeN(events, 2)).toEqual([`opened ${NEXT_SESSION}`, 'caught up 0'])
        expect(yield* Queue.size(events)).toBe(0)
      }),
  )

  it.effect('works the demand out again only when a watch comes or goes, never per event', () => {
    const spans: string[] = []
    const demandsWorkedOut = () => Arr.filter(spans, (name) => name === DEMAND_SPAN).length

    return Effect.gen(function* () {
      const transcripts = yield* relay
      const demands = yield* Queue.unbounded<readonly TranscriptWatchId[]>()

      yield* transcripts.demands(LAPTOP).pipe(
        Stream.runForEach((demand) =>
          Queue.offer(
            demands,
            Arr.map(demand.watches, (watch) => watch.id),
          ),
        ),
        Effect.forkScoped,
      )
      yield* Queue.take(demands)
      const events = yield* watching(transcripts, paneSource, Option.none())
      const id = yield* onlyWatch(yield* Queue.take(demands))
      const beforeEvents = demandsWorkedOut()

      yield* transcripts.publish(LAPTOP, id, [opened])
      yield* Queue.take(events)
      yield* Effect.forEach(
        Arr.makeBy(20, (index) => chunkBetween(index * 10, index * 10 + 10)),
        (chunk) => Effect.andThen(transcripts.publish(LAPTOP, id, [chunk]), Queue.take(events)),
        { discard: true },
      )
      const afterEvents = demandsWorkedOut()

      yield* watching(transcripts, paneSource, Option.none())
      const both = yield* Queue.take(demands)
      const demand = yield* transcripts.demands(LAPTOP).pipe(Stream.runHead)

      expect(beforeEvents).toBeGreaterThan(0)
      expect(afterEvents).toBe(beforeEvents)
      expect(demandsWorkedOut()).toBe(beforeEvents + 2)
      expect(both).toHaveLength(2)
      expect(
        Option.flatMap(demand, (current) =>
          Option.map(Arr.head(current.watches), (watch) => watch.from),
        ),
      ).toEqual(Option.some(Option.some(at(200))))
    }).pipe(Effect.withTracer(countingSpans(spans)))
  })

  it.effect('leaves the position alone when a publish waiting on a full mailbox is cut off', () =>
    Effect.gen(function* () {
      const transcripts = yield* relay
      const deliveries = yield* Queue.unbounded<readonly string[]>()
      const acknowledged = yield* Deferred.make<void>()

      yield* transcripts.watch(LAPTOP, paneSource, Option.none(), Option.none()).pipe(
        Stream.runForEachArray((events) =>
          Effect.andThen(
            Queue.offer(deliveries, Arr.map(events, describeEvent)),
            Deferred.await(acknowledged),
          ),
        ),
        Effect.ignore({ log: 'Debug' }),
        Effect.forkScoped,
      )
      const id = yield* onlyWatch(yield* watchIds(transcripts, LAPTOP, 1))
      const fromOfDemand = transcripts
        .demands(LAPTOP)
        .pipe(
          Stream.runHead,
          Effect.map(
            Option.flatMap((current) =>
              Option.flatMap(Arr.head(current.watches), (watch) => watch.from),
            ),
          ),
        )
      const next = chunkBetween(CHUNK_READ_LIMIT, CHUNK_READ_LIMIT + 10)

      yield* transcripts.publish(LAPTOP, id, [opened])
      yield* Queue.take(deliveries)
      yield* transcripts.publish(LAPTOP, id, [chunkBetween(0, CHUNK_READ_LIMIT)])
      const waiting = yield* Effect.forkChild(transcripts.publish(LAPTOP, id, [next]), {
        startImmediately: true,
      })
      yield* Fiber.interrupt(waiting)
      const cutOff = yield* Effect.exit(Fiber.join(waiting))
      const afterCutOff = yield* fromOfDemand

      yield* Deferred.succeed(acknowledged, undefined)
      yield* transcripts.publish(LAPTOP, id, [next])

      expect(Exit.hasInterrupts(cutOff)).toBe(true)
      expect(afterCutOff).toEqual(Option.some(at(CHUNK_READ_LIMIT)))
      expect(yield* Queue.takeN(deliveries, 2)).toEqual([
        [`chunk 0-${CHUNK_READ_LIMIT} 1`],
        [`chunk ${CHUNK_READ_LIMIT}-${CHUNK_READ_LIMIT + 10} 1`],
      ])
      expect(yield* fromOfDemand).toEqual(Option.some(at(CHUNK_READ_LIMIT + 10)))
    }),
  )

  it.effect('stops counting a link once a later link asks for demands', () =>
    Effect.gen(function* () {
      const transcripts = yield* relay
      const events = yield* watching(transcripts, paneSource, Option.none())
      const id = yield* onlyWatch(yield* watchIds(transcripts, LAPTOP, 1))
      const successor = yield* transcripts.linkFor(LAPTOP)

      yield* transcripts.publish(LAPTOP, id, [opened])

      const beforeTheSuccessorSpoke = yield* Queue.take(events)

      yield* Stream.runHead(successor.demands)
      yield* transcripts.publish(LAPTOP, id, [new TranscriptOpened({ session: NEXT_SESSION })])
      yield* successor.publish(id, [chunkBetween(0, 10)])

      expect(beforeTheSuccessorSpoke).toBe(describeEvent(opened))
      expect(yield* Queue.take(events)).toBe(describeEvent(chunkBetween(0, 10)))
    }),
  )

  it.effect('keeps counting a link while a later one has connected and said nothing', () =>
    Effect.gen(function* () {
      const transcripts = yield* relay
      const events = yield* watching(transcripts, paneSource, Option.none())
      const id = yield* onlyWatch(yield* watchIds(transcripts, LAPTOP, 1))

      yield* transcripts.linkFor(LAPTOP)
      yield* transcripts.publish(LAPTOP, id, [opened])

      expect(yield* Queue.take(events)).toBe(describeEvent(opened))
    }),
  )

  it.effect('does not hand the watch back when an older link asks for demands late', () =>
    Effect.gen(function* () {
      const transcripts = yield* relay
      const events = yield* watching(transcripts, paneSource, Option.none())
      const id = yield* onlyWatch(yield* watchIds(transcripts, LAPTOP, 1))
      const successor = yield* transcripts.linkFor(LAPTOP)

      yield* Stream.runHead(successor.demands)
      yield* Stream.runHead(transcripts.demands(LAPTOP))
      yield* transcripts.publish(LAPTOP, id, [new TranscriptOpened({ session: NEXT_SESSION })])
      yield* successor.publish(id, [opened])

      expect(yield* Queue.take(events)).toBe(describeEvent(opened))
    }),
  )

  it.effect('lets go of a publish blocked on a full mailbox when its link is replaced', () =>
    Effect.gen(function* () {
      const transcripts = yield* relay
      const events = yield* Queue.unbounded<string>()
      const acknowledged = yield* Deferred.make<void>()

      yield* transcripts.watch(LAPTOP, paneSource, Option.none(), Option.none()).pipe(
        Stream.runForEachArray((taken) =>
          Effect.andThen(
            Queue.offerAll(events, Arr.map(taken, describeEvent)),
            Deferred.await(acknowledged),
          ),
        ),
        Effect.ignore({ log: 'Debug' }),
        Effect.forkScoped,
      )
      const id = yield* onlyWatch(yield* watchIds(transcripts, LAPTOP, 1))
      const successor = yield* transcripts.linkFor(LAPTOP)
      const full = chunkBetween(0, CHUNK_READ_LIMIT)
      const stale = chunkBetween(CHUNK_READ_LIMIT, CHUNK_READ_LIMIT + 10)

      yield* transcripts.publish(LAPTOP, id, [opened])
      yield* Queue.take(events)
      yield* transcripts.publish(LAPTOP, id, [full])
      const blocked = yield* Effect.forkChild(transcripts.publish(LAPTOP, id, [stale]), {
        startImmediately: true,
      })

      yield* Stream.runHead(successor.demands)
      yield* Fiber.join(blocked)
      const demand = yield* Stream.runHead(successor.demands)

      expect(
        Option.map(demand, (current) => Arr.map(current.watches, (watch) => watch.from)),
      ).toEqual(Option.some([Option.some(at(CHUNK_READ_LIMIT))]))

      yield* Deferred.succeed(acknowledged, undefined)
      yield* successor.publish(id, [stale])

      expect(yield* Queue.takeN(events, 2)).toEqual([describeEvent(full), describeEvent(stale)])
    }),
  )
})
