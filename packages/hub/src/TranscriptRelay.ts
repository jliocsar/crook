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
import * as Semaphore from 'effect/Semaphore'
import * as Stream from 'effect/Stream'
import * as SubscriptionRef from 'effect/SubscriptionRef'
import * as TxRef from 'effect/TxRef'

import type { MachineId } from '@crook/domain/Ids'
import {
  type SkillsChanged,
  type SubagentsChanged,
  type TranscriptCaughtUp,
  type TranscriptChunk,
  type TranscriptEvent,
  type TranscriptPosition,
  type TranscriptSource,
  type TranscriptTailBytes,
  continuesFrom,
  inSession,
  positionAfter,
} from '@crook/domain/Transcript'
import {
  TranscriptDemand,
  type TranscriptFailure,
  TranscriptOutOfStep,
  type TranscriptUpdate,
  TranscriptWatch,
  type TranscriptWatchFailed,
  TranscriptWatchId,
  isWatchFailed,
} from '@crook/protocol/Transcripts'
import { type TranscriptMailbox, makeTranscriptMailbox } from '@crook/protocol/TranscriptBatch'

interface Watcher {
  readonly machine: MachineId
  readonly source: TranscriptSource
  readonly delivered: TxRef.TxRef<Option.Option<TranscriptPosition>>
  readonly tail: Option.Option<TranscriptTailBytes>
  readonly inbox: TranscriptMailbox
  readonly delivery: Semaphore.Semaphore
}

type Watchers = HashMap.HashMap<TranscriptWatchId, Watcher>

const eventsOf = (updates: NonEmptyReadonlyArray<TranscriptUpdate>) =>
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

const upToFailure = (updates: NonEmptyReadonlyArray<TranscriptUpdate>) =>
  pipe(
    Arr.findFirstIndex(updates, isWatchFailed),
    Option.match({
      onNone: () => updates,
      onSome: (index) => Arr.take(updates, index + 1),
    }),
  )

const byWatchId = Order.mapInput(Order.Number, ([id]: readonly [TranscriptWatchId, Watcher]) => id)

const demandOf = Effect.fn('TranscriptRelay.demandOf')(function* (
  watchers: Watchers,
  machine: MachineId,
) {
  const watches = yield* Effect.forEach(
    pipe(
      Arr.fromIterable(watchers),
      Arr.filter(([, watcher]) => watcher.machine === machine),
      Arr.sort(byWatchId),
    ),
    ([id, watcher]) =>
      Effect.map(
        TxRef.get(watcher.delivered),
        (from) => new TranscriptWatch({ id, source: watcher.source, from, tail: watcher.tail }),
      ),
  )

  return new TranscriptDemand({ watches })
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
        const delivered = yield* TxRef.make(from)

        yield* Effect.acquireRelease(
          SubscriptionRef.update(
            watchers,
            HashMap.set(id, { machine, source, delivered, tail, inbox, delivery }),
          ),
          () => Effect.andThen(SubscriptionRef.update(watchers, HashMap.remove(id)), inbox.close),
        )

        return Stream.fromEffectRepeat(inbox.take).pipe(Stream.flatMap(eventsOf))
      }),
    )

  const demands = (machine: MachineId) =>
    SubscriptionRef.changes(watchers).pipe(
      Stream.mapEffect((current) => demandOf(current, machine)),
      Stream.changesWith(sameWatches),
    )

  const forward = (watcher: Watcher, event: TranscriptEvent) =>
    Effect.tx(
      Effect.andThen(
        watcher.inbox.offer(event),
        TxRef.update(watcher.delivered, (position) => positionAfter(position, event)),
      ),
    )

  const forwardInSession = (
    watcher: Watcher,
    position: Option.Option<TranscriptPosition>,
    event: SubagentsChanged | SkillsChanged | TranscriptCaughtUp,
  ) => (inSession(position, event.session) ? forward(watcher, event) : Effect.void)

  const append = (
    id: TranscriptWatchId,
    watcher: Watcher,
    position: Option.Option<TranscriptPosition>,
    chunk: TranscriptChunk,
  ) =>
    continuesFrom(position, chunk)
      ? forward(watcher, chunk)
      : Effect.fail(new TranscriptOutOfStep({ watch: id, expected: position }))

  const fail = (id: TranscriptWatchId, watcher: Watcher, failed: TranscriptWatchFailed) =>
    Effect.andThen(
      watcher.inbox.offer(failed),
      SubscriptionRef.update(watchers, HashMap.remove(id)),
    )

  const deliver = (id: TranscriptWatchId, watcher: Watcher, update: TranscriptUpdate) =>
    Effect.flatMap(TxRef.get(watcher.delivered), (position) =>
      Match.value(update).pipe(
        Match.tagsExhaustive({
          TranscriptOpened: (opened) =>
            inSession(position, opened.session) ? Effect.void : forward(watcher, opened),
          TranscriptChunk: (chunk) => append(id, watcher, position, chunk),
          SubagentsChanged: (changed) => forwardInSession(watcher, position, changed),
          SkillsChanged: (changed) => forwardInSession(watcher, position, changed),
          TranscriptCaughtUp: (caughtUp) => forwardInSession(watcher, position, caughtUp),
          TranscriptWatchFailed: (failed) => fail(id, watcher, failed),
        }),
      ),
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
          Effect.forEach(upToFailure(updates), (update) => deliver(id, found, update), {
            discard: true,
          }),
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
