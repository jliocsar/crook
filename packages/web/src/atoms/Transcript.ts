import * as Data from 'effect/Data'
import * as Effect from 'effect/Effect'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Atom from 'effect/reactivity/Atom'
import * as Stream from 'effect/Stream'
import * as SubscriptionRef from 'effect/SubscriptionRef'

import { findMachine, isOnline } from '@crook/domain/HerdView'
import type { ClaudeSessionId, MachineId, PaneId, SubagentId } from '@crook/domain/Ids'
import {
  PaneTranscript,
  SubagentTranscript,
  TranscriptTailBytes,
  type TranscriptSource,
} from '@crook/domain/Transcript'
import { herdAtom } from '@crook/web/atoms/Herd'
import { hubRuntime } from '@crook/web/atoms/Hub'
import {
  applyTranscriptEvent,
  EMPTY_TRANSCRIPT,
  failedWith,
  isOpened,
  resumeOf,
} from '@crook/web/chat/TranscriptState'
import type { TranscriptView, TranscriptWatchFailure } from '@crook/web/chat/TranscriptState'
import { findAgent } from '@crook/web/herd/HerdLayout'
import { HubLink } from '@crook/web/rpc/HubLink'

export interface WatchSignals {
  readonly watchable: Stream.Stream<boolean>
  readonly retries: Stream.Stream<number>
}

export type TranscriptKey = PaneTranscriptKey | SubagentTranscriptKey

export const CHAT_OPEN_TAIL = TranscriptTailBytes.make(512 * 1024)

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

const isWorthShowing = (view: TranscriptView): boolean =>
  isOpened(view) || Option.isSome(view.failure)

const isResumeRejected = (failure: TranscriptWatchFailure): boolean =>
  Match.value(failure).pipe(
    Match.tag('TranscriptResumeRejected', () => true),
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
      const view = yield* SubscriptionRef.make(EMPTY_TRANSCRIPT)
      const restarts = yield* SubscriptionRef.make(0)

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

      const watchOnce = Effect.gen(function* () {
        const restartsAtStart = yield* SubscriptionRef.get(restarts)

        yield* link
          .watchTranscript(
            machine,
            source,
            Effect.map(SubscriptionRef.get(view), resumeOf(tailFor(whole))),
          )
          .pipe(
            Stream.runForEach((event) =>
              SubscriptionRef.update(view, (current) => applyTranscriptEvent(current, event)),
            ),
            Effect.andThen(Effect.never),
            Effect.catch((failure) => settle(failure, restartsAtStart)),
          )
      })

      yield* Effect.forkScoped(Effect.forever(watchOnce))

      return SubscriptionRef.changes(view).pipe(Stream.filter(isWorthShowing))
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

const machineWatchableAtom = Atom.family((machine: MachineId) =>
  Atom.make((get) =>
    Option.exists(get(herdAtom), (snapshot) =>
      Option.exists(findMachine(snapshot.view, machine), isOnline),
    ),
  ),
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
      watchable: get.stream(watchableAtomOf(key)),
      retries: get.stream(transcriptRetryAtom(key), { withoutInitialValue: true }),
    }),
  ),
)
