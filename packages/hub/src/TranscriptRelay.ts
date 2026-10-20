import * as Arr from 'effect/Array'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import { pipe } from 'effect/Function'
import * as HashMap from 'effect/HashMap'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Order from 'effect/Order'
import * as Queue from 'effect/Queue'
import * as Ref from 'effect/Ref'
import * as Result from 'effect/Result'
import * as Semaphore from 'effect/Semaphore'
import * as Stream from 'effect/Stream'
import * as SubscriptionRef from 'effect/SubscriptionRef'

import type { HerdView } from '@crook/domain/HerdView'
import type { MachineId } from '@crook/domain/Ids'
import {
  type TranscriptChunk,
  type TranscriptEvent,
  type TranscriptOpened,
  type TranscriptPosition,
  type TranscriptSource,
  continuesFrom,
  positionAfter,
} from '@crook/domain/Transcript'
import { MachineNotInHerd, PaneNotInHerd } from '@crook/protocol/ClientApi'
import {
  TranscriptDemand,
  type TranscriptFailure,
  TranscriptOutOfStep,
  type TranscriptUpdate,
  TranscriptWatch,
  TranscriptWatchId,
} from '@crook/protocol/Transcripts'

interface Watcher {
  readonly machine: MachineId
  readonly source: TranscriptSource
  readonly position: Option.Option<TranscriptPosition>
  readonly inbox: Queue.Queue<TranscriptEvent, TranscriptFailure>
  readonly delivery: Semaphore.Semaphore
}

type Watchers = HashMap.HashMap<TranscriptWatchId, Watcher>

const PHONE_INBOX_CAPACITY = 1

export const admitWatch = (
  view: HerdView,
  machine: MachineId,
  source: TranscriptSource,
): Result.Result<void, MachineNotInHerd | PaneNotInHerd> =>
  pipe(
    Arr.findFirst(view.machines, (entry) => entry.machine.id === machine),
    Option.match({
      onNone: () => Result.fail(new MachineNotInHerd({ machine })),
      onSome: (entry) =>
        Match.value(source).pipe(
          Match.tagsExhaustive({
            PaneTranscript: ({ pane }) =>
              pipe(
                entry.state,
                Option.flatMap((state) => Arr.findFirst(state.agents, (row) => row.pane === pane)),
                Option.match({
                  onNone: () => Result.fail(new PaneNotInHerd({ machine, pane })),
                  onSome: () => Result.void,
                }),
              ),
            SubagentTranscript: () => Result.void,
          }),
        ),
    }),
  )

const demandOf = (watchers: Watchers, machine: MachineId) =>
  new TranscriptDemand({
    watches: pipe(
      Arr.fromIterable(watchers),
      Arr.filter(([, watcher]) => watcher.machine === machine),
      Arr.map(
        ([id, watcher]) =>
          new TranscriptWatch({ id, source: watcher.source, from: watcher.position }),
      ),
      Arr.sort(Order.mapInput(Order.Number, (watch: TranscriptWatch) => watch.id)),
    ),
  })

const sameWatches = (self: TranscriptDemand, that: TranscriptDemand) =>
  Arr.makeEquivalence((left: TranscriptWatch, right: TranscriptWatch) => left.id === right.id)(
    self.watches,
    that.watches,
  )

const make = Effect.gen(function* () {
  const watchers = yield* SubscriptionRef.make<Watchers>(HashMap.empty())
  const nextId = yield* Ref.make(0)

  const watch = (
    machine: MachineId,
    source: TranscriptSource,
    from: Option.Option<TranscriptPosition>,
  ) =>
    Stream.unwrap(
      Effect.gen(function* () {
        const id = TranscriptWatchId.make(yield* Ref.getAndUpdate(nextId, (current) => current + 1))
        const inbox = yield* Queue.bounded<TranscriptEvent, TranscriptFailure>(PHONE_INBOX_CAPACITY)
        const delivery = yield* Semaphore.make(1)

        yield* Effect.acquireRelease(
          SubscriptionRef.update(
            watchers,
            HashMap.set(id, { machine, source, position: from, inbox, delivery }),
          ),
          () =>
            Effect.andThen(
              SubscriptionRef.update(watchers, HashMap.remove(id)),
              Queue.shutdown(inbox),
            ),
        )

        return Stream.fromQueue(inbox)
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
    Effect.andThen(Queue.offer(watcher.inbox, event), advance(id, event))

  const open = (id: TranscriptWatchId, watcher: Watcher, opened: TranscriptOpened) =>
    Option.exists(watcher.position, (position) => position.session === opened.session)
      ? Effect.void
      : forward(id, watcher, opened)

  const append = (id: TranscriptWatchId, watcher: Watcher, chunk: TranscriptChunk) =>
    continuesFrom(watcher.position, chunk)
      ? forward(id, watcher, chunk)
      : Effect.fail(new TranscriptOutOfStep({ watch: id, expected: watcher.position }))

  const fail = (id: TranscriptWatchId, watcher: Watcher, failure: TranscriptFailure) =>
    Effect.andThen(
      SubscriptionRef.update(watchers, HashMap.remove(id)),
      Queue.fail(watcher.inbox, failure),
    )

  const deliver = (id: TranscriptWatchId, update: TranscriptUpdate) =>
    Effect.flatMap(SubscriptionRef.get(watchers), (current) =>
      Option.match(HashMap.get(current, id), {
        onNone: () => Effect.void,
        onSome: (watcher) =>
          Match.value(update).pipe(
            Match.tagsExhaustive({
              TranscriptOpened: (opened) => open(id, watcher, opened),
              TranscriptChunk: (chunk) => append(id, watcher, chunk),
              SubagentsChanged: (changed) => Queue.offer(watcher.inbox, changed),
              TranscriptWatchFailed: (failed) => fail(id, watcher, failed.failure),
            }),
            Effect.andThen(Effect.void),
          ),
      }),
    )

  const publish = Effect.fn('TranscriptRelay.publish')(function* (
    machine: MachineId,
    id: TranscriptWatchId,
    update: TranscriptUpdate,
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
      onSome: (found) => found.delivery.withPermit(deliver(id, update)),
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
    ) => Stream.Stream<TranscriptEvent, TranscriptFailure>
    readonly demands: (machine: MachineId) => Stream.Stream<TranscriptDemand>
    readonly publish: (
      machine: MachineId,
      id: TranscriptWatchId,
      update: TranscriptUpdate,
    ) => Effect.Effect<void, TranscriptOutOfStep>
  }
>()('@crook/hub/TranscriptRelay') {
  static readonly layer = Layer.effect(this, make)
}
