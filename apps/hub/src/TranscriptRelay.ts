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
  type BackgroundChanged,
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
  reachesPast,
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

export interface TranscriptAgentLink {
  readonly demands: Stream.Stream<TranscriptDemand>
  readonly publish: (
    id: TranscriptWatchId,
    updates: NonEmptyReadonlyArray<TranscriptUpdate>,
  ) => Effect.Effect<void, TranscriptOutOfStep>
}

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
  const nextLink = yield* Ref.make(0)
  const latestLinks = yield* TxRef.make(HashMap.empty<MachineId, number>())

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

  const askedForDemands = (machine: MachineId, link: number) =>
    TxRef.update(latestLinks, (latest) =>
      HashMap.set(
        latest,
        machine,
        Math.max(
          link,
          Option.getOrElse(HashMap.get(latest, machine), () => link),
        ),
      ),
    )

  const stillCounts = (machine: MachineId, link: number) =>
    Effect.map(TxRef.get(latestLinks), (latest) =>
      Option.match(HashMap.get(latest, machine), {
        onNone: () => true,
        onSome: (newest) => link >= newest,
      }),
    )

  const demands = (machine: MachineId, link: number) =>
    Stream.unwrap(
      Effect.as(
        askedForDemands(machine, link),
        SubscriptionRef.changes(watchers).pipe(
          Stream.mapEffect((current) => demandOf(current, machine)),
          Stream.changesWith(sameWatches),
        ),
      ),
    )

  const publishOver = (machine: MachineId, link: number) => {
    const forward = (watcher: Watcher, event: TranscriptEvent) =>
      Effect.tx(
        Effect.flatMap(stillCounts(machine, link), (counts) =>
          counts
            ? Effect.andThen(
                watcher.inbox.offer(event),
                TxRef.update(watcher.delivered, (position) => positionAfter(position, event)),
              )
            : Effect.void,
        ),
      )

    const forwardInSession = (
      watcher: Watcher,
      position: Option.Option<TranscriptPosition>,
      event: SubagentsChanged | SkillsChanged | BackgroundChanged | TranscriptCaughtUp,
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

    const passOnCaughtUp = (
      id: TranscriptWatchId,
      watcher: Watcher,
      position: Option.Option<TranscriptPosition>,
      caughtUp: TranscriptCaughtUp,
    ) =>
      reachesPast(position, caughtUp)
        ? Effect.fail(new TranscriptOutOfStep({ watch: id, expected: position }))
        : forwardInSession(watcher, position, caughtUp)

    const fail = (id: TranscriptWatchId, watcher: Watcher, failed: TranscriptWatchFailed) =>
      Effect.flatMap(stillCounts(machine, link), (counts) =>
        counts
          ? Effect.andThen(
              watcher.inbox.offer(failed),
              SubscriptionRef.update(watchers, HashMap.remove(id)),
            )
          : Effect.void,
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
            BackgroundChanged: (changed) => forwardInSession(watcher, position, changed),
            TranscriptCaughtUp: (caughtUp) => passOnCaughtUp(id, watcher, position, caughtUp),
            TranscriptWatchFailed: (failed) => fail(id, watcher, failed),
          }),
        ),
      )

    return Effect.fn('TranscriptRelay.publish')(function* (
      id: TranscriptWatchId,
      updates: NonEmptyReadonlyArray<TranscriptUpdate>,
    ) {
      if (!(yield* stillCounts(machine, link))) {
        return yield* Effect.logDebug(
          `Dropped an update for transcript watch ${id}: machine ${machine} has connected again since this call was sent.`,
        )
      }

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
  }

  const linkFor = (machine: MachineId) =>
    Effect.map(
      Ref.getAndUpdate(nextLink, (current) => current + 1),
      (link): TranscriptAgentLink => ({
        demands: demands(machine, link),
        publish: publishOver(machine, link),
      }),
    )

  return TranscriptRelay.of({ watch, linkFor })
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
    readonly linkFor: (machine: MachineId) => Effect.Effect<TranscriptAgentLink>
  }
>()('@crook/hub/TranscriptRelay') {
  static readonly layer = Layer.effect(this, make)
}
