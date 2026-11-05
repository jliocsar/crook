import * as Arr from 'effect/Array'
import * as Data from 'effect/Data'
import * as Effect from 'effect/Effect'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Queue from 'effect/Queue'
import * as AsyncResult from 'effect/reactivity/AsyncResult'
import * as Atom from 'effect/reactivity/Atom'
import * as AtomRegistry from 'effect/reactivity/AtomRegistry'
import * as Stream from 'effect/Stream'
import * as SubscriptionRef from 'effect/SubscriptionRef'

import { isBehind } from '@crook/domain/CrookVersion'
import { findMachine, type HerdView, isOnline } from '@crook/domain/HerdView'
import type { ClaudeSessionId, MachineId, PaneId, SubagentId } from '@crook/domain/Ids'
import {
  PaneTranscript,
  SubagentTranscript,
  TranscriptTailBytes,
  type TranscriptEvent,
  type TranscriptSource,
} from '@crook/domain/Transcript'
import { herdAtom, herdViewAtom } from '@crook/web/atoms/Herd'
import { hubRuntime } from '@crook/web/atoms/Hub'
import { TranscriptCache } from '@crook/web/cache/TranscriptCache'
import {
  afterAll,
  cacheRead,
  EARLIER_ASKED,
  emptyWait,
  eventArrived,
  foldOf,
  isCaughtUp,
  NO_VIEW,
  noticeHold,
  noticeWait,
  rememberedOf,
  sameOnScreen,
  TranscriptCommand,
  TranscriptViewState,
  watchFailed,
  watchResumed,
} from '@crook/web/chat/TranscriptMachine'
import type { TranscriptViewEvent, TranscriptWatchFailure } from '@crook/web/chat/TranscriptMachine'
import { resumeOf } from '@crook/web/chat/TranscriptState'
import { findAgent, isOnlineMachine } from '@crook/web/herd/HerdLayout'
import { HubLink } from '@crook/web/rpc/HubLink'

export interface WatchSignals {
  readonly watchable: Atom.Atom<boolean>
  readonly retries: Atom.Atom<number>
  readonly earlier: Atom.Atom<number>
  readonly awaitsCaughtUp: Atom.Atom<boolean>
  readonly herd: Atom.Atom<Option.Option<HerdView>>
}

export type TranscriptKey = PaneTranscriptKey | SubagentTranscriptKey

const CHAT_OPEN_TAIL = TranscriptTailBytes.make(512 * 1024)

export class PaneTranscriptKey extends Data.TaggedClass('PaneTranscriptKey')<{
  readonly machine: MachineId
  readonly pane: PaneId
}> {}

export class SubagentTranscriptKey extends Data.TaggedClass('SubagentTranscriptKey')<{
  readonly machine: MachineId
  readonly session: ClaudeSessionId
  readonly subagent: SubagentId
}> {}

const sourceOf = (key: TranscriptKey): TranscriptSource =>
  Match.value(key).pipe(
    Match.tagsExhaustive({
      PaneTranscriptKey: (pane): TranscriptSource => new PaneTranscript({ pane: pane.pane }),
      SubagentTranscriptKey: (subagent): TranscriptSource =>
        new SubagentTranscript({ session: subagent.session, subagent: subagent.subagent }),
    }),
  )

const subscribed = Effect.fn('Transcript.subscribed')(function* <Value>(
  registry: AtomRegistry.AtomRegistry,
  atom: Atom.Atom<Value>,
) {
  const changes = yield* Queue.unbounded<Value>()

  yield* Effect.acquireRelease(
    Effect.sync(() =>
      registry.subscribe(
        atom,
        (value) => {
          Queue.offerUnsafe(changes, value)
        },
        { immediate: true },
      ),
    ),
    (unsubscribe) => Effect.sync(unsubscribe),
  )

  return Stream.fromQueue(changes).pipe(Stream.changes, Stream.drop(1))
})

const countedPast = (count: SubscriptionRef.SubscriptionRef<number>, past: number) =>
  SubscriptionRef.changes(count).pipe(
    Stream.filter((seen) => seen > past),
    Stream.take(1),
    Stream.runDrain,
  )

const transcriptViews = (machine: MachineId, source: TranscriptSource, signals: WatchSignals) =>
  Stream.unwrap(
    Effect.gen(function* () {
      const link = yield* HubLink
      const cache = yield* TranscriptCache
      const registry = yield* AtomRegistry.AtomRegistry
      const scope = yield* Effect.scope
      const watchableChanges = yield* subscribed(registry, signals.watchable)
      const retryChanges = yield* subscribed(registry, signals.retries)
      const earlierChanges = yield* subscribed(registry, signals.earlier)
      const herdKnown = Effect.suspend(() =>
        Option.isSome(registry.get(signals.herd))
          ? Effect.void
          : AtomRegistry.toStream(registry, signals.herd).pipe(
              Stream.filter(Option.isSome),
              Stream.take(1),
              Stream.runDrain,
            ),
      )
      const readAwaitsCaughtUp = Effect.andThen(
        herdKnown,
        Effect.sync(() => registry.get(signals.awaitsCaughtUp)),
      )
      const cached = yield* cache.load(machine, source)
      const state = yield* SubscriptionRef.make<TranscriptViewState>(
        afterAll(NO_VIEW, [cacheRead(cached)])[0],
      )
      const restarts = yield* SubscriptionRef.make(0)
      const rereads = yield* SubscriptionRef.make(0)
      const persist = Effect.suspend(() =>
        cache.persist(machine, source, registry.get(signals.herd)),
      )

      yield* Effect.addFinalizer(() => persist)

      const dispatch = (
        events: readonly TranscriptViewEvent[],
      ): Effect.Effect<TranscriptViewState> =>
        Effect.flatMap(
          SubscriptionRef.modify(state, (current) => {
            const [next, commands] = afterAll(current, events)

            return [{ next, commands }, next]
          }),
          ({ next, commands }) =>
            Effect.as(Effect.forEach(commands, perform, { discard: true }), next),
        )

      const afterTimer = (timer: Effect.Effect<TranscriptViewEvent>) =>
        Effect.forkIn(
          Effect.flatMap(timer, (event) => dispatch([event])),
          scope,
        )

      const perform: (command: TranscriptCommand) => Effect.Effect<void> = TranscriptCommand.$match(
        {
          WaitOutNotice: ({ attempt }) => afterTimer(noticeWait(attempt)),
          HoldNotice: ({ attempt }) => afterTimer(noticeHold(attempt)),
          WaitOutEmpty: ({ attempt }) => afterTimer(emptyWait(attempt)),
          ReadAgain: () => SubscriptionRef.update(rereads, (count) => count + 1),
        },
      )

      yield* Stream.merge(
        watchableChanges.pipe(Stream.filter((ready) => ready)),
        retryChanges,
      ).pipe(
        Stream.runForEach(() => SubscriptionRef.update(restarts, (count) => count + 1)),
        Effect.forkScoped,
      )

      yield* earlierChanges.pipe(
        Stream.runForEach(() => dispatch([EARLIER_ASKED])),
        Effect.forkScoped,
      )

      const settle = Effect.fn('Transcript.settle')(function* (
        failure: TranscriptWatchFailure,
        restartsAtStart: number,
      ) {
        const next = yield* dispatch([watchFailed(failure)])

        if (TranscriptViewState.guards.Failed(next)) {
          yield* countedPast(restarts, restartsAtStart)
        }
      })

      const resume = Effect.flatMap(readAwaitsCaughtUp, (awaits) =>
        Effect.map(dispatch([watchResumed(awaits)]), (next) =>
          resumeOf(foldOf(next), Option.some(CHAT_OPEN_TAIL)),
        ),
      )

      const apply = Effect.fn('Transcript.apply')(function* (
        events: Arr.NonEmptyReadonlyArray<TranscriptEvent>,
      ) {
        const next = yield* dispatch(Arr.map(events, eventArrived))

        yield* Option.match(rememberedOf(next), {
          onNone: () => Effect.void,
          onSome: (view) => cache.remember(machine, source, view),
        })

        if (Arr.some(events, isCaughtUp)) {
          yield* persist
        }
      })

      const watchOnce = Effect.gen(function* () {
        const restartsAtStart = yield* SubscriptionRef.get(restarts)
        const rereadsAtStart = yield* SubscriptionRef.get(rereads)

        yield* link.watchTranscript(machine, source, resume).pipe(
          Stream.runForEachArray(apply),
          Effect.andThen(Effect.never),
          Effect.catch((failure) => settle(failure, restartsAtStart)),
          Effect.raceFirst(countedPast(rereads, rereadsAtStart)),
        )
      })

      yield* Effect.forkScoped(Effect.forever(watchOnce))

      return SubscriptionRef.changes(state).pipe(Stream.changesWith(sameOnScreen))
    }),
  )

const paneWatchableAtom = Atom.family((key: PaneTranscriptKey) =>
  Atom.make((get) =>
    Option.exists(get(herdAtom), (snapshot) =>
      Option.exists(findAgent(snapshot.view, key.machine, key.pane), ({ herdMachine }) =>
        isOnline(herdMachine),
      ),
    ),
  ),
)

const awaitsCaughtUpAtom = Atom.family((machine: MachineId) =>
  Atom.make((get) =>
    Option.exists(get(herdAtom), (snapshot) =>
      Option.exists(findMachine(snapshot.view, machine), (entry) =>
        Option.exists(
          entry.machine.agentVersion,
          (version) => !isBehind(version, snapshot.view.hubVersion),
        ),
      ),
    ),
  ),
)

const machineWatchableAtom = Atom.family((machine: MachineId) =>
  Atom.make((get) => Option.exists(get(herdViewAtom), (view) => isOnlineMachine(view, machine))),
)

export const transcriptRetryAtom = Atom.family((key: TranscriptKey) =>
  Atom.make(0).pipe(Atom.withLabel(`transcript retries on ${key.machine}`)),
)

export const transcriptEarlierAtom = Atom.family((key: TranscriptKey) =>
  Atom.make(0).pipe(Atom.withLabel(`earlier messages asked on ${key.machine}`)),
)

const watchableAtomOf = (key: TranscriptKey): Atom.Atom<boolean> =>
  Match.value(key).pipe(
    Match.tagsExhaustive({
      PaneTranscriptKey: (pane) => paneWatchableAtom(pane),
      SubagentTranscriptKey: (subagent) => machineWatchableAtom(subagent.machine),
    }),
  )

export const transcriptAtom = Atom.family((key: TranscriptKey) =>
  hubRuntime.atom(
    transcriptViews(key.machine, sourceOf(key), {
      watchable: watchableAtomOf(key),
      retries: transcriptRetryAtom(key),
      earlier: transcriptEarlierAtom(key),
      awaitsCaughtUp: awaitsCaughtUpAtom(key.machine),
      herd: herdViewAtom,
    }),
  ),
)

export const transcriptStateOf = (
  result: AsyncResult.AsyncResult<TranscriptViewState, unknown>,
): TranscriptViewState => Option.getOrElse(AsyncResult.value(result), () => NO_VIEW)
