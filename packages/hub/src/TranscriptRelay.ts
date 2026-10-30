import * as Arr from 'effect/Array'
import type { NonEmptyReadonlyArray } from 'effect/Array'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import { pipe } from 'effect/Function'
import * as HashMap from 'effect/HashMap'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Order from 'effect/Order'
import * as Ref from 'effect/Ref'
import * as Schema from 'effect/Schema'
import * as Semaphore from 'effect/Semaphore'
import * as Stream from 'effect/Stream'
import * as SubscriptionRef from 'effect/SubscriptionRef'

import type { MachineId } from '@crook/domain/Ids'
import {
  type TranscriptChunk,
  type TranscriptEvent,
  type TranscriptPosition,
  type TranscriptSource,
  type TranscriptTailBytes,
  continuesFrom,
  positionAfter,
  remainderAfter,
} from '@crook/domain/Transcript'
import {
  TranscriptDemand,
  type TranscriptFailure,
  TranscriptOutOfStep,
  type TranscriptUpdate,
  TranscriptWatch,
  TranscriptWatchFailed,
  TranscriptWatchId,
} from '@crook/protocol/Transcripts'
import { type TranscriptMailbox, makeTranscriptMailbox } from '@crook/protocol/TranscriptBatch'

interface Watcher {
  readonly machine: MachineId
  readonly source: TranscriptSource
  readonly position: Option.Option<TranscriptPosition>
  readonly tail: Option.Option<TranscriptTailBytes>
  readonly inbox: TranscriptMailbox
  readonly delivery: Semaphore.Semaphore
}

type Watchers = HashMap.HashMap<TranscriptWatchId, Watcher>

const isWatchFailed = Schema.is(TranscriptWatchFailed)

const unseenOnly = (
  delivered: Option.Option<TranscriptPosition>,
  event: TranscriptEvent,
): readonly [Option.Option<TranscriptPosition>, readonly TranscriptEvent[]] =>
  Option.match(remainderAfter(delivered, event), {
    onNone: () => [delivered, []],
    onSome: (unseen) => [positionAfter(delivered, unseen), [unseen]],
  })

const delivered = (updates: NonEmptyReadonlyArray<TranscriptUpdate>) =>
  Stream.concat(
    Stream.fromArray(
      Arr.flatMap(updates, (update) =>
        Match.value(update).pipe(
          Match.tag('TranscriptWatchFailed', (): readonly TranscriptEvent[] => []),
          Match.orElse((event) => [event]),
        ),
      ),
    ),
    pipe(
      Arr.findFirst(updates, isWatchFailed),
      Option.match({
        onNone: () => Stream.empty,
        onSome: (failed) => Stream.fail(failed.failure),
      }),
    ),
  )

const demandOf = (watchers: Watchers, machine: MachineId) =>
  new TranscriptDemand({
    watches: pipe(
      Arr.fromIterable(watchers),
      Arr.filter(([, watcher]) => watcher.machine === machine),
      Arr.map(
        ([id, watcher]) =>
          new TranscriptWatch({
            id,
            source: watcher.source,
            from: watcher.position,
            tail: watcher.tail,
          }),
      ),
      Arr.sort(Order.mapInput(Order.Number, (watch: TranscriptWatch) => watch.id)),
    ),
  })

const sameWatchIds = Arr.makeEquivalence(
  (left: TranscriptWatch, right: TranscriptWatch) => left.id === right.id,
)

const sameWatches = (self: TranscriptDemand, that: TranscriptDemand) =>
  sameWatchIds(self.watches, that.watches)

const make = Effect.gen(function* () {
  const watchers = yield* SubscriptionRef.make<Watchers>(HashMap.empty())
  const nextId = yield* Ref.make(0)

  const watch = (
    machine: MachineId,
    source: TranscriptSource,
    from: Option.Option<TranscriptPosition>,
    tail: Option.Option<TranscriptTailBytes>,
  ) =>
    Stream.unwrap(
      Effect.gen(function* () {
        const id = TranscriptWatchId.make(yield* Ref.getAndUpdate(nextId, (current) => current + 1))
        const inbox = yield* makeTranscriptMailbox
        const delivery = yield* Semaphore.make(1)

        yield* Effect.acquireRelease(
          SubscriptionRef.update(
            watchers,
            HashMap.set(id, { machine, source, position: from, tail, inbox, delivery }),
          ),
          () => Effect.andThen(SubscriptionRef.update(watchers, HashMap.remove(id)), inbox.close),
        )

        return Stream.fromEffectRepeat(inbox.take).pipe(
          Stream.flatMap(delivered),
          Stream.mapAccum(() => from, unseenOnly),
        )
      }),
    )

  const demands = (machine: MachineId) =>
    SubscriptionRef.changes(watchers).pipe(
      Stream.map((current) => demandOf(current, machine)),
      Stream.changesWith(sameWatches),
    )

  const advance = (id: TranscriptWatchId, event: TranscriptEvent) =>
    SubscriptionRef.update(
      watchers,
      HashMap.modify(id, (watcher) => ({
        ...watcher,
        position: positionAfter(watcher.position, event),
      })),
    )

  const forward = (id: TranscriptWatchId, watcher: Watcher, event: TranscriptEvent) =>
    Effect.andThen(watcher.inbox.offer(event), advance(id, event))

  const append = (id: TranscriptWatchId, watcher: Watcher, chunk: TranscriptChunk) =>
    continuesFrom(watcher.position, chunk)
      ? forward(id, watcher, chunk)
      : Effect.fail(new TranscriptOutOfStep({ watch: id, expected: watcher.position }))

  const fail = (id: TranscriptWatchId, watcher: Watcher, failed: TranscriptWatchFailed) =>
    Effect.andThen(
      watcher.inbox.offer(failed),
      SubscriptionRef.update(watchers, HashMap.remove(id)),
    )

  const deliver = (id: TranscriptWatchId, update: TranscriptUpdate) =>
    Effect.flatMap(SubscriptionRef.get(watchers), (current) =>
      Option.match(HashMap.get(current, id), {
        onNone: () => Effect.void,
        onSome: (watcher) =>
          Match.value(update).pipe(
            Match.tagsExhaustive({
              TranscriptOpened: (opened) => forward(id, watcher, opened),
              TranscriptChunk: (chunk) => append(id, watcher, chunk),
              SubagentsChanged: (changed) => forward(id, watcher, changed),
              SkillsChanged: (changed) => forward(id, watcher, changed),
              TranscriptCaughtUp: (caughtUp) => forward(id, watcher, caughtUp),
              TranscriptWatchFailed: (failed) => fail(id, watcher, failed),
            }),
          ),
      }),
    )

  const publish = Effect.fn('TranscriptRelay.publish')(function* (
    machine: MachineId,
    id: TranscriptWatchId,
    updates: NonEmptyReadonlyArray<TranscriptUpdate>,
  ) {
    const watcher = pipe(
      HashMap.get(yield* SubscriptionRef.get(watchers), id),
      Option.filter((found) => found.machine === machine),
    )

    return yield* Option.match(watcher, {
      onNone: () =>
        Effect.logDebug(
          `Dropped an update for transcript watch ${id}: no phone on this machine watches it any more.`,
        ),
      onSome: (found) =>
        found.delivery.withPermit(
          Effect.forEach(updates, (update) => deliver(id, update), { discard: true }),
        ),
    })
  })

  return TranscriptRelay.of({ watch, demands, publish })
})

export class TranscriptRelay extends Context.Service<
  TranscriptRelay,
  {
    readonly watch: (
      machine: MachineId,
      source: TranscriptSource,
      from: Option.Option<TranscriptPosition>,
      tail: Option.Option<TranscriptTailBytes>,
    ) => Stream.Stream<TranscriptEvent, TranscriptFailure>
    readonly demands: (machine: MachineId) => Stream.Stream<TranscriptDemand>
    readonly publish: (
      machine: MachineId,
      id: TranscriptWatchId,
      updates: NonEmptyReadonlyArray<TranscriptUpdate>,
    ) => Effect.Effect<void, TranscriptOutOfStep>
  }
>()('@crook/hub/TranscriptRelay') {
  static readonly layer = Layer.effect(this, make)
}
