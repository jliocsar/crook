import * as Data from 'effect/Data'
import * as Effect from 'effect/Effect'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Queue from 'effect/Queue'
import * as Ref from 'effect/Ref'
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
  applyTranscriptEvent,
  catchingUpFrom,
  EMPTY_TRANSCRIPT,
  failedWith,
  isOpened,
  isShowable,
  resumeOf,
  shownAfter,
} from '@crook/web/chat/TranscriptState'
import type { TranscriptWatchFailure } from '@crook/web/chat/TranscriptState'
import { findAgent, isOnlineMachine } from '@crook/web/herd/HerdLayout'
import { HubLink } from '@crook/web/rpc/HubLink'

export interface WatchSignals {
  readonly watchable: Atom.Atom<boolean>
  readonly retries: Atom.Atom<number>
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

const tailFor = (whole: boolean) => (whole ? Option.none() : Option.some(CHAT_OPEN_TAIL))

const sourceOf = (key: TranscriptKey): TranscriptSource =>
  Match.value(key).pipe(
    Match.tagsExhaustive({
      PaneTranscriptKey: (pane): TranscriptSource => new PaneTranscript({ pane: pane.pane }),
      SubagentTranscriptKey: (subagent): TranscriptSource =>
        new SubagentTranscript({ session: subagent.session, subagent: subagent.subagent }),
    }),
  )

const isResumeRejected = (failure: TranscriptWatchFailure): boolean =>
  Match.value(failure).pipe(
    Match.tag('TranscriptResumeRejected', () => true),
    Match.orElse(() => false),
  )

const isCaughtUp = (event: TranscriptEvent): boolean =>
  Match.value(event).pipe(
    Match.tag('TranscriptCaughtUp', () => true),
    Match.orElse(() => false),
  )

const subscribed = Effect.fn('Transcript.subscribed')(function* <Value>(
  registry: AtomRegistry.AtomRegistry,
  atom: Atom.Atom<Value>,
  immediate: boolean,
) {
  const changes = yield* Queue.unbounded<Value>()

  yield* Effect.acquireRelease(
    Effect.sync(() =>
      registry.subscribe(
        atom,
        (value) => {
          Queue.offerUnsafe(changes, value)
        },
        { immediate },
      ),
    ),
    (unsubscribe) => Effect.sync(unsubscribe),
  )

  return Stream.fromQueue(changes)
})

const transcriptViews = (
  machine: MachineId,
  source: TranscriptSource,
  whole: boolean,
  signals: WatchSignals,
) =>
  Stream.unwrap(
    Effect.gen(function* () {
      const link = yield* HubLink
      const cache = yield* TranscriptCache
      const registry = yield* AtomRegistry.AtomRegistry
      const watchableChanges = yield* subscribed(registry, signals.watchable, true)
      const retryChanges = yield* subscribed(registry, signals.retries, false)
      const awaitsCaughtUpChanges = yield* subscribed(registry, signals.awaitsCaughtUp, false)
      const herdChanges = yield* subscribed(registry, signals.herd, false)
      const awaitsCaughtUpNow = registry.get(signals.awaitsCaughtUp)
      const cached = yield* cache.load(machine, source)
      const view = yield* SubscriptionRef.make(
        catchingUpFrom(
          whole ? EMPTY_TRANSCRIPT : Option.getOrElse(cached, () => EMPTY_TRANSCRIPT),
          awaitsCaughtUpNow,
        ),
      )
      const restarts = yield* SubscriptionRef.make(0)
      const awaitsCaughtUp = yield* Ref.make(awaitsCaughtUpNow)
      const herd = yield* Ref.make(registry.get(signals.herd))
      const persist = Effect.flatMap(Ref.get(herd), (current) =>
        cache.persist(machine, source, current),
      )

      yield* awaitsCaughtUpChanges.pipe(
        Stream.runForEach((awaits) => Ref.set(awaitsCaughtUp, awaits)),
        Effect.forkScoped,
      )
      yield* herdChanges.pipe(
        Stream.runForEach((current) => Ref.set(herd, current)),
        Effect.forkScoped,
      )

      yield* Effect.addFinalizer(() => persist)

      yield* Stream.merge(
        watchableChanges.pipe(
          Stream.changes,
          Stream.drop(1),
          Stream.filter((ready) => ready),
        ),
        retryChanges,
      ).pipe(
        Stream.runForEach(() => SubscriptionRef.update(restarts, (count) => count + 1)),
        Effect.forkScoped,
      )

      const settle = Effect.fn('Transcript.settle')(function* (
        failure: TranscriptWatchFailure,
        restartsAtStart: number,
      ) {
        const current = yield* SubscriptionRef.get(view)

        if (isResumeRejected(failure) && isOpened(current)) {
          return yield* SubscriptionRef.set(view, EMPTY_TRANSCRIPT)
        }

        yield* SubscriptionRef.set(view, failedWith(current, failure))

        return yield* SubscriptionRef.changes(restarts).pipe(
          Stream.filter((count) => count > restartsAtStart),
          Stream.take(1),
          Stream.runDrain,
        )
      })

      const resume = Effect.flatMap(Ref.get(awaitsCaughtUp), (awaits) =>
        SubscriptionRef.modify(view, (current) => [
          resumeOf(current, tailFor(whole)),
          catchingUpFrom(current, awaits),
        ]),
      )

      const apply = Effect.fn('Transcript.apply')(function* (event: TranscriptEvent) {
        const next = yield* SubscriptionRef.updateAndGet(view, (current) =>
          applyTranscriptEvent(current, event),
        )

        if (isShowable(next)) {
          yield* cache.remember(machine, source, next)
        }

        if (isCaughtUp(event)) {
          yield* persist
        }
      })

      const watchOnce = Effect.gen(function* () {
        const restartsAtStart = yield* SubscriptionRef.get(restarts)

        yield* link.watchTranscript(machine, source, resume).pipe(
          Stream.runForEach(apply),
          Effect.andThen(Effect.never),
          Effect.catch((failure) => settle(failure, restartsAtStart)),
        )
      })

      yield* Effect.forkScoped(Effect.forever(watchOnce))

      return SubscriptionRef.changes(view).pipe(Stream.mapAccum(() => cached, shownAfter))
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

export const transcriptWholeAtom = Atom.family((key: TranscriptKey) =>
  Atom.make(false).pipe(Atom.withLabel(`whole transcript on ${key.machine}`)),
)

const watchableAtomOf = (key: TranscriptKey): Atom.Atom<boolean> =>
  Match.value(key).pipe(
    Match.tagsExhaustive({
      PaneTranscriptKey: (pane) => paneWatchableAtom(pane),
      SubagentTranscriptKey: (subagent) => machineWatchableAtom(subagent.machine),
    }),
  )

export const transcriptAtom = Atom.family((key: TranscriptKey) =>
  hubRuntime.atom((get) =>
    transcriptViews(key.machine, sourceOf(key), get(transcriptWholeAtom(key)), {
      watchable: watchableAtomOf(key),
      retries: transcriptRetryAtom(key),
      awaitsCaughtUp: awaitsCaughtUpAtom(key.machine),
      herd: herdViewAtom,
    }),
  ),
)
