import * as Data from 'effect/Data'
import * as Effect from 'effect/Effect'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Ref from 'effect/Ref'
import * as Atom from 'effect/reactivity/Atom'
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
} from '@crook/web/chat/TranscriptState'
import type { TranscriptWatchFailure } from '@crook/web/chat/TranscriptState'
import { findAgent, isOnlineMachine } from '@crook/web/herd/HerdLayout'
import { HubLink } from '@crook/web/rpc/HubLink'

export interface Followed<Value> {
  readonly now: Value
  readonly changes: Stream.Stream<Value>
}

export interface WatchSignals {
  readonly watchable: Stream.Stream<boolean>
  readonly retries: Stream.Stream<number>
  readonly awaitsCaughtUp: Followed<boolean>
  readonly herd: Followed<Option.Option<HerdView>>
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
      const cached = yield* cache.load(machine, source)
      const view = yield* SubscriptionRef.make(
        whole ? EMPTY_TRANSCRIPT : Option.getOrElse(cached, () => EMPTY_TRANSCRIPT),
      )
      const restarts = yield* SubscriptionRef.make(0)
      const awaitsCaughtUp = yield* Ref.make(signals.awaitsCaughtUp.now)
      const herd = yield* Ref.make(signals.herd.now)
      const persist = Effect.flatMap(Ref.get(herd), (current) =>
        cache.persist(machine, source, current),
      )

      yield* signals.awaitsCaughtUp.changes.pipe(
        Stream.runForEach((awaits) => Ref.set(awaitsCaughtUp, awaits)),
        Effect.forkScoped,
      )
      yield* signals.herd.changes.pipe(
        Stream.runForEach((current) => Ref.set(herd, current)),
        Effect.forkScoped,
      )

      yield* Effect.addFinalizer(() => persist)

      yield* Stream.merge(
        signals.watchable.pipe(
          Stream.changes,
          Stream.drop(1),
          Stream.filter((ready) => ready),
        ),
        signals.retries,
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

      return Stream.concat(
        Stream.fromIterable(Option.toArray(cached)),
        SubscriptionRef.changes(view).pipe(Stream.filter(isShowable)),
      )
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

const followed = <Value>(get: Atom.AtomContext, atom: Atom.Atom<Value>): Followed<Value> => ({
  now: get.once(atom),
  changes: get.stream(atom, { withoutInitialValue: true }),
})

export const transcriptAtom = Atom.family((key: TranscriptKey) =>
  hubRuntime.atom((get) =>
    transcriptViews(key.machine, sourceOf(key), get(transcriptWholeAtom(key)), {
      watchable: get.stream(watchableAtomOf(key)),
      retries: get.stream(transcriptRetryAtom(key), { withoutInitialValue: true }),
      awaitsCaughtUp: followed(get, awaitsCaughtUpAtom(key.machine)),
      herd: followed(get, herdViewAtom),
    }),
  ),
)
