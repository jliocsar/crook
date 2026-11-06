import * as Arr from 'effect/Array'
import * as Data from 'effect/Data'
import * as Effect from 'effect/Effect'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'

import type { ClaudeSessionId } from '@crook/domain/Ids'
import type { SkillListing } from '@crook/domain/Skill'
import { TranscriptCaughtUp, TranscriptEvent } from '@crook/domain/Transcript'
import { MachineNotInHerd, PaneNotInHerd } from '@crook/protocol/ClientApi'
import { TranscriptFailure } from '@crook/protocol/Transcripts'
import { landedOver, pendingOver } from '@crook/web/chat/CatchUp'
import {
  applyTranscriptEvent,
  EMPTY_TRANSCRIPT,
  hasLines,
  isOpened,
  LaptopCatchUp,
  opensAnotherSession,
  readAgain,
  sessionOf,
  TranscriptView,
  withoutPendingCatchUp,
} from '@crook/web/chat/TranscriptState'
import { caseName, to } from '@crook/state-machine/Machine'
import type { Machine, Step } from '@crook/state-machine/Machine'
import { NOTICE_DELAY, NOTICE_HOLD } from '@crook/web/machine/NoticeTiming'
import { HubCallDefected } from '@crook/web/rpc/HubConnection'

export type TranscriptCommand = Data.TaggedEnum<{
  WaitOutNotice: { readonly attempt: number }
  HoldNotice: { readonly attempt: number }
  WaitOutEmpty: { readonly attempt: number }
  ReadAgain: Record<never, never>
}>

type TranscriptStep = Step<TranscriptViewState, TranscriptCommand>

const AnyView = Schema.instanceOf(TranscriptView)

export const TranscriptWatchFailure = Schema.Union([
  MachineNotInHerd,
  PaneNotInHerd,
  TranscriptFailure,
  HubCallDefected,
])
export type TranscriptWatchFailure = typeof TranscriptWatchFailure.Type

export const TranscriptViewState = Schema.TaggedUnion({
  NoView: {
    fold: AnyView,
    attempt: Schema.Int,
    awaits: Schema.Boolean,
    restarting: Schema.Boolean,
  },
  Cached: { view: AnyView },
  Holding: { shown: AnyView, fold: AnyView, attempt: Schema.Int, awaits: Schema.Boolean },
  CatchingUp: {
    shown: AnyView,
    fold: AnyView,
    attempt: Schema.Int,
    noticeHeld: Schema.Boolean,
  },
  NoticeLeaving: { view: AnyView, attempt: Schema.Int },
  LoadingEarlier: {
    shown: AnyView,
    fold: AnyView,
    attempt: Schema.Int,
    awaits: Schema.Boolean,
    restarting: Schema.Boolean,
  },
  Current: { view: AnyView, attempt: Schema.Int, awaits: Schema.Boolean },
  OpenedEmpty: { view: AnyView, attempt: Schema.Int, awaits: Schema.Boolean },
  Failed: {
    shown: AnyView,
    fold: AnyView,
    failure: TranscriptWatchFailure,
    attempt: Schema.Int,
    awaits: Schema.Boolean,
  },
  Retrying: {
    shown: AnyView,
    fold: AnyView,
    failure: TranscriptWatchFailure,
    attempt: Schema.Int,
    awaits: Schema.Boolean,
  },
})
export type TranscriptViewState = typeof TranscriptViewState.Type

export const TranscriptViewEvent = Schema.TaggedUnion({
  CacheRead: { cached: Schema.Option(AnyView) },
  WatchResumed: { awaits: Schema.Boolean },
  EventArrived: { event: TranscriptEvent },
  WatchFailed: { failure: TranscriptWatchFailure },
  EarlierAsked: {},
  NoticeDue: { attempt: Schema.Int },
  NoticeHeld: { attempt: Schema.Int },
  EmptyDue: { attempt: Schema.Int },
})
export type TranscriptViewEvent = typeof TranscriptViewEvent.Type

export const NO_VIEW = TranscriptViewState.cases.NoView.make({
  fold: EMPTY_TRANSCRIPT,
  attempt: 0,
  awaits: false,
  restarting: false,
})

export const EARLIER_ASKED = TranscriptViewEvent.cases.EarlierAsked.make({})

export const TranscriptCommand = Data.taggedEnum<TranscriptCommand>()

export const cacheRead = (cached: Option.Option<TranscriptView>) =>
  TranscriptViewEvent.cases.CacheRead.make({ cached })
export const watchResumed = (awaits: boolean) =>
  TranscriptViewEvent.cases.WatchResumed.make({ awaits })
export const eventArrived = (event: TranscriptEvent) =>
  TranscriptViewEvent.cases.EventArrived.make({ event })
export const watchFailed = (failure: TranscriptWatchFailure) =>
  TranscriptViewEvent.cases.WatchFailed.make({ failure })
export const noticeDue = (attempt: number) => TranscriptViewEvent.cases.NoticeDue.make({ attempt })
export const noticeHeld = (attempt: number) =>
  TranscriptViewEvent.cases.NoticeHeld.make({ attempt })
export const emptyDue = (attempt: number) => TranscriptViewEvent.cases.EmptyDue.make({ attempt })

const noView = (fold: TranscriptView, attempt: number, awaits: boolean, restarting = false) =>
  TranscriptViewState.cases.NoView.make({ fold, attempt, awaits, restarting })

const cachedState = (view: TranscriptView) => TranscriptViewState.cases.Cached.make({ view })

const holding = (shown: TranscriptView, fold: TranscriptView, attempt: number, awaits: boolean) =>
  TranscriptViewState.cases.Holding.make({ shown, fold, attempt, awaits })

const catchingUp = (shown: TranscriptView, fold: TranscriptView, attempt: number, held: boolean) =>
  TranscriptViewState.cases.CatchingUp.make({ shown, fold, attempt, noticeHeld: held })

const noticeLeaving = (view: TranscriptView, attempt: number) =>
  TranscriptViewState.cases.NoticeLeaving.make({ view, attempt })

const loadingEarlier = (
  shown: TranscriptView,
  fold: TranscriptView,
  attempt: number,
  awaits: boolean,
  restarting: boolean,
) => TranscriptViewState.cases.LoadingEarlier.make({ shown, fold, attempt, awaits, restarting })

const current = (view: TranscriptView, attempt: number, awaits: boolean) =>
  TranscriptViewState.cases.Current.make({ view, attempt, awaits })

const openedEmpty = (view: TranscriptView, attempt: number, awaits: boolean) =>
  TranscriptViewState.cases.OpenedEmpty.make({ view, attempt, awaits })

const failed = (
  shown: TranscriptView,
  fold: TranscriptView,
  failure: TranscriptWatchFailure,
  attempt: number,
  awaits: boolean,
) => TranscriptViewState.cases.Failed.make({ shown, fold, failure, attempt, awaits })

const retrying = (
  shown: TranscriptView,
  fold: TranscriptView,
  failure: TranscriptWatchFailure,
  attempt: number,
  awaits: boolean,
) => TranscriptViewState.cases.Retrying.make({ shown, fold, failure, attempt, awaits })

export const foldOf = (state: TranscriptViewState): TranscriptView =>
  Match.value(state).pipe(
    Match.withReturnType<TranscriptView>(),
    Match.tags({
      Cached: ({ view }) => view,
      NoticeLeaving: ({ view }) => view,
      Current: ({ view }) => view,
      OpenedEmpty: ({ view }) => view,
    }),
    Match.orElse(({ fold }) => fold),
  )

export const shownOf = (state: TranscriptViewState): Option.Option<TranscriptView> =>
  Match.value(state).pipe(
    Match.withReturnType<Option.Option<TranscriptView>>(),
    Match.tag('NoView', () => Option.none()),
    Match.tags({
      Cached: ({ view }) => Option.some(view),
      NoticeLeaving: ({ view }) => Option.some(view),
      Current: ({ view }) => Option.some(view),
      OpenedEmpty: ({ view }) => Option.some(view),
    }),
    Match.orElse(({ shown }) => Option.some(shown)),
  )

export const attemptOf = (state: TranscriptViewState): number =>
  Match.value(state).pipe(
    Match.tag('Cached', () => 0),
    Match.orElse(({ attempt }) => attempt),
  )

export const awaitsOf = (state: TranscriptViewState): boolean =>
  Match.value(state).pipe(
    Match.tag('Cached', () => false),
    Match.tags({
      CatchingUp: () => true,
      NoticeLeaving: () => true,
    }),
    Match.orElse(({ awaits }) => awaits),
  )

export const isRestarting = (state: TranscriptViewState): boolean =>
  Match.value(state).pipe(
    Match.tags({
      NoView: ({ restarting }) => restarting,
      LoadingEarlier: ({ restarting }) => restarting,
    }),
    Match.orElse(() => false),
  )

export const threadSessionOf = (state: TranscriptViewState): Option.Option<ClaudeSessionId> =>
  Option.orElse(sessionOf(Option.some(foldOf(state))), () => sessionOf(shownOf(state)))

export const skillsOf = (state: TranscriptViewState): readonly SkillListing[] =>
  foldOf(state).skills

export const failureOf = (state: TranscriptViewState): Option.Option<TranscriptWatchFailure> =>
  Match.value(state).pipe(
    Match.withReturnType<Option.Option<TranscriptWatchFailure>>(),
    Match.tags({
      Failed: ({ failure }) => Option.some(failure),
      Retrying: ({ failure }) => Option.some(failure),
    }),
    Match.orElse(() => Option.none()),
  )

export const isRetrying = TranscriptViewState.guards.Retrying
export const isLoadingEarlier = TranscriptViewState.guards.LoadingEarlier
export const isCaughtUp = Schema.is(TranscriptCaughtUp)
export const hasFailed = TranscriptViewState.isAnyOf(['Failed', 'Retrying'])
export const knowsNothing = TranscriptViewState.isAnyOf(['NoView', 'Failed', 'Retrying'])
export const saysCatchingUp = TranscriptViewState.isAnyOf(['CatchingUp', 'NoticeLeaving'])
export const holdsBack = TranscriptViewState.isAnyOf([
  'NoView',
  'Holding',
  'CatchingUp',
  'LoadingEarlier',
  'Retrying',
])

export const rememberedOf = (state: TranscriptViewState): Option.Option<TranscriptView> =>
  Match.value(state).pipe(
    Match.withReturnType<Option.Option<TranscriptView>>(),
    Match.tags({
      NoticeLeaving: ({ view }) => Option.some(view),
      Current: ({ view }) => Option.some(view),
      OpenedEmpty: ({ view }) => Option.some(view),
    }),
    Match.orElse(() => Option.none()),
  )

const waitForEmpty = (fold: TranscriptView, attempt: number): readonly TranscriptCommand[] =>
  isOpened(fold) && !hasLines(fold) ? [TranscriptCommand.WaitOutEmpty({ attempt })] : []

const nothingKnown = (fold: TranscriptView, attempt: number, awaits: boolean): TranscriptStep => [
  noView(fold, attempt, awaits),
  awaits ? [] : waitForEmpty(fold, attempt),
]

const heldBack = (
  shown: TranscriptView,
  fold: TranscriptView,
  attempt: number,
  awaits: boolean,
): TranscriptStep => [
  holding(shown, fold, attempt, awaits),
  awaits ? [TranscriptCommand.WaitOutNotice({ attempt })] : [],
]

const resumedWithRows = (
  shown: TranscriptView,
  fold: TranscriptView,
  attempt: number,
  awaits: boolean,
): TranscriptStep =>
  !awaits && hasLines(fold)
    ? to(current(withoutPendingCatchUp(fold), attempt, awaits))
    : heldBack(shown, fold, attempt, awaits)

const resumed = (state: TranscriptViewState, awaits: boolean): TranscriptStep => {
  const attempt = attemptOf(state) + 1

  return Match.value(state).pipe(
    Match.withReturnType<TranscriptStep>(),
    Match.tagsExhaustive({
      NoView: ({ fold }) => nothingKnown(fold, attempt, awaits),
      Cached: ({ view }) => resumedWithRows(view, view, attempt, awaits),
      Holding: ({ shown, fold }) => resumedWithRows(shown, fold, attempt, awaits),
      CatchingUp: ({ shown, fold, noticeHeld: held }) =>
        awaits
          ? [
              catchingUp(shown, fold, attempt, held),
              held ? [] : [TranscriptCommand.HoldNotice({ attempt })],
            ]
          : resumedWithRows(shown, fold, attempt, awaits),
      NoticeLeaving: ({ view }) =>
        awaits
          ? [catchingUp(view, view, attempt, false), [TranscriptCommand.HoldNotice({ attempt })]]
          : to(current(view, attempt, awaits)),
      LoadingEarlier: ({ shown, fold }) =>
        !awaits && hasLines(fold)
          ? to(current(fold, attempt, awaits))
          : to(loadingEarlier(shown, fold, attempt, awaits, false)),
      Current: ({ view }) => resumedWithRows(view, view, attempt, awaits),
      OpenedEmpty: ({ view }) =>
        awaits ? heldBack(view, view, attempt, awaits) : to(openedEmpty(view, attempt, awaits)),
      Failed: ({ shown, fold, failure }) => to(retrying(shown, fold, failure, attempt, awaits)),
      Retrying: ({ shown, fold, failure }) => to(retrying(shown, fold, failure, attempt, awaits)),
    }),
  )
}

const judged = (fold: TranscriptView): TranscriptView =>
  LaptopCatchUp.$match(fold.catchUp, {
    None: () => fold,
    Landed: () => fold,
    Pending: ({ lines }) => landedOver(lines, fold),
  })

const landed = (state: TranscriptViewState, fold: TranscriptView): TranscriptStep => {
  const view = judged(fold)
  const attempt = attemptOf(state)
  const awaits = awaitsOf(state)

  if (!hasLines(view)) {
    return to(openedEmpty(view, attempt, awaits))
  }

  return Match.value(state).pipe(
    Match.withReturnType<TranscriptStep>(),
    Match.tag('CatchingUp', ({ noticeHeld: held }) =>
      to(held ? current(view, attempt, awaits) : noticeLeaving(view, attempt)),
    ),
    Match.tag('NoticeLeaving', () => to(noticeLeaving(view, attempt))),
    Match.orElse(() => to(current(view, attempt, awaits))),
  )
}

const leftSession = (state: TranscriptViewState, next: TranscriptView): TranscriptStep => {
  const attempt = attemptOf(state)
  const awaits = awaitsOf(state)

  return foldOf(state).whole
    ? [noView(readAgain(next, false), attempt, awaits, true), [TranscriptCommand.ReadAgain()]]
    : nothingKnown(next, attempt, awaits)
}

const overRows = (
  shown: TranscriptView,
  next: TranscriptView,
  attempt: number,
  awaits: boolean,
): TranscriptStep => {
  if (!awaits && hasLines(next)) {
    return to(current(next, attempt, awaits))
  }

  return hasLines(shown)
    ? heldBack(shown, next, attempt, awaits)
    : nothingKnown(next, attempt, awaits)
}

const arrivedWithNoView = (
  fold: TranscriptView,
  next: TranscriptView,
  attempt: number,
  awaits: boolean,
): TranscriptStep => {
  if (awaits) {
    return to(noView(next, attempt, awaits))
  }

  if (hasLines(next)) {
    return to(current(next, attempt, awaits))
  }

  return isOpened(fold) ? to(noView(next, attempt, awaits)) : nothingKnown(next, attempt, awaits)
}

const arrivedWhileHolding = (
  shown: TranscriptView,
  next: TranscriptView,
  attempt: number,
  awaits: boolean,
): TranscriptStep => {
  if (!hasLines(next)) {
    return to(holding(shown, next, attempt, awaits))
  }

  if (!awaits) {
    return to(current(next, attempt, awaits))
  }

  return to(hasLines(shown) ? holding(shown, next, attempt, awaits) : noView(next, attempt, awaits))
}

const arrivedWhile = (state: TranscriptViewState, next: TranscriptView): TranscriptStep =>
  Match.value(state).pipe(
    Match.withReturnType<TranscriptStep>(),
    Match.tagsExhaustive({
      NoView: ({ fold, attempt, awaits }) => arrivedWithNoView(fold, next, attempt, awaits),
      Cached: () => to(state),
      Holding: ({ shown, attempt, awaits }) => arrivedWhileHolding(shown, next, attempt, awaits),
      CatchingUp: ({ shown, attempt, noticeHeld: held }) =>
        !hasLines(shown) && hasLines(next)
          ? to(noView(next, attempt, true))
          : to(catchingUp(shown, next, attempt, held)),
      NoticeLeaving: ({ attempt }) => to(noticeLeaving(next, attempt)),
      LoadingEarlier: ({ shown, attempt, awaits }) =>
        !awaits && hasLines(next)
          ? to(current(next, attempt, awaits))
          : to(loadingEarlier(shown, next, attempt, awaits, false)),
      Current: ({ attempt, awaits }) => to(current(next, attempt, awaits)),
      OpenedEmpty: ({ attempt, awaits }) =>
        hasLines(next)
          ? to(current(next, attempt, awaits))
          : to(openedEmpty(next, attempt, awaits)),
      Failed: ({ shown, attempt, awaits }) => overRows(shown, next, attempt, awaits),
      Retrying: ({ shown, attempt, awaits }) => overRows(shown, next, attempt, awaits),
    }),
  )

const arrived = (state: TranscriptViewState, event: TranscriptEvent): TranscriptStep => {
  if (isRestarting(state) || TranscriptViewState.guards.Cached(state)) {
    return to(state)
  }

  const shownPosition = Option.flatMap(shownOf(state), (shown) => shown.position)
  const knownPosition = Option.orElse(foldOf(state).position, () => shownPosition)
  const next = applyTranscriptEvent(foldOf(state), event)

  if (opensAnotherSession(knownPosition, event)) {
    return leftSession(state, next)
  }

  if (isCaughtUp(event)) {
    return isOpened(next) ? landed(state, next) : to(state)
  }

  return arrivedWhile(state, next)
}

const freshestOf = (state: TranscriptViewState): TranscriptView =>
  Option.match(shownOf(state), {
    onNone: () => foldOf(state),
    onSome: (shown) => (hasLines(foldOf(state)) || !hasLines(shown) ? foldOf(state) : shown),
  })

const isResumeRejected = (failure: TranscriptWatchFailure): boolean =>
  Match.value(failure).pipe(
    Match.tag('TranscriptResumeRejected', () => true),
    Match.orElse(() => false),
  )

const startedOver = (state: TranscriptViewState): TranscriptStep => {
  const fold = readAgain(foldOf(state), false)
  const attempt = attemptOf(state)
  const awaits = awaitsOf(state)

  return Option.match(Option.filter(shownOf(state), hasLines), {
    onNone: () => to(noView(fold, attempt, awaits)),
    onSome: (shown) =>
      to(
        saysCatchingUp(state)
          ? catchingUp(
              shown,
              fold,
              attempt,
              TranscriptViewState.guards.CatchingUp(state) && state.noticeHeld,
            )
          : holding(shown, fold, attempt, awaits),
      ),
  })
}

const watchEnded = (
  state: TranscriptViewState,
  failure: TranscriptWatchFailure,
): TranscriptStep => {
  if (isRestarting(state)) {
    return to(state)
  }

  return isResumeRejected(failure) && isOpened(foldOf(state))
    ? startedOver(state)
    : to(
        failed(
          withoutPendingCatchUp(freshestOf(state)),
          withoutPendingCatchUp(foldOf(state)),
          failure,
          attemptOf(state),
          awaitsOf(state),
        ),
      )
}

const canAskEarlier = TranscriptViewState.isAnyOf([
  'Cached',
  'Holding',
  'CatchingUp',
  'NoticeLeaving',
  'Current',
  'Failed',
  'Retrying',
])

const earlierAsked = (state: TranscriptViewState): TranscriptStep =>
  canAskEarlier(state)
    ? Option.match(Option.filter(shownOf(state), hasLines), {
        onNone: () => to(state),
        onSome: (shown) => [
          loadingEarlier(
            shown,
            readAgain(foldOf(state), true),
            attemptOf(state),
            awaitsOf(state),
            true,
          ),
          [TranscriptCommand.ReadAgain()],
        ],
      })
    : to(state)

const noticeWaitEnded = (state: TranscriptViewState, attempt: number): TranscriptStep =>
  Match.value(state).pipe(
    Match.withReturnType<TranscriptStep>(),
    Match.tag('Holding', (waiting) =>
      waiting.attempt === attempt && waiting.awaits
        ? [
            catchingUp(waiting.shown, waiting.fold, attempt, false),
            [TranscriptCommand.HoldNotice({ attempt })],
          ]
        : to(state),
    ),
    Match.orElse(() => to(state)),
  )

const noticeHoldEnded = (state: TranscriptViewState, attempt: number): TranscriptStep =>
  Match.value(state).pipe(
    Match.withReturnType<TranscriptStep>(),
    Match.tag('CatchingUp', (shown) =>
      to(shown.attempt === attempt ? catchingUp(shown.shown, shown.fold, attempt, true) : state),
    ),
    Match.tag('NoticeLeaving', (leaving) =>
      to(leaving.attempt === attempt ? current(leaving.view, attempt, true) : state),
    ),
    Match.orElse(() => to(state)),
  )

const emptyWaitEnded = (state: TranscriptViewState, attempt: number): TranscriptStep =>
  Match.value(state).pipe(
    Match.withReturnType<TranscriptStep>(),
    Match.tag('NoView', (waiting) =>
      to(
        waiting.attempt === attempt &&
          !waiting.awaits &&
          !waiting.restarting &&
          isOpened(waiting.fold) &&
          !hasLines(waiting.fold)
          ? openedEmpty(waiting.fold, attempt, false)
          : state,
      ),
    ),
    Match.orElse(() => to(state)),
  )

const hasNotStarted = (state: TranscriptViewState): boolean =>
  TranscriptViewState.guards.NoView(state) && state.attempt === 0 && !isOpened(state.fold)

const opening = (cached: Option.Option<TranscriptView>): TranscriptStep =>
  Option.match(cached, {
    onNone: () => to(NO_VIEW),
    onSome: (view) => to(cachedState(pendingOver(view))),
  })

const transcriptTransition = (
  state: TranscriptViewState,
  event: TranscriptViewEvent,
): TranscriptStep =>
  Match.value(event).pipe(
    Match.withReturnType<TranscriptStep>(),
    Match.tagsExhaustive({
      CacheRead: ({ cached }) => (hasNotStarted(state) ? opening(cached) : to(state)),
      WatchResumed: ({ awaits }) => resumed(state, awaits),
      EventArrived: ({ event: arriving }) => arrived(state, arriving),
      WatchFailed: ({ failure }) => watchEnded(state, failure),
      EarlierAsked: () => earlierAsked(state),
      NoticeDue: ({ attempt }) => noticeWaitEnded(state, attempt),
      NoticeHeld: ({ attempt }) => noticeHoldEnded(state, attempt),
      EmptyDue: ({ attempt }) => emptyWaitEnded(state, attempt),
    }),
  )

export const transcriptMachine: Machine<
  TranscriptViewState,
  TranscriptViewEvent,
  TranscriptCommand
> = {
  name: 'transcript',
  states: TranscriptViewState,
  events: TranscriptViewEvent,
  initial: NO_VIEW,
  transition: transcriptTransition,
}

const startingAt = (state: TranscriptViewState): TranscriptStep => [state, []]

export const afterAll = (
  state: TranscriptViewState,
  events: readonly TranscriptViewEvent[],
): TranscriptStep =>
  Arr.reduce(events, startingAt(state), ([from, commands], event) => {
    const [next, more] = transcriptTransition(from, event)

    return [next, [...commands, ...more]]
  })

export const noticeWait = (attempt: number): Effect.Effect<TranscriptViewEvent> =>
  Effect.as(Effect.sleep(NOTICE_DELAY), noticeDue(attempt))

export const noticeHold = (attempt: number): Effect.Effect<TranscriptViewEvent> =>
  Effect.as(Effect.sleep(NOTICE_HOLD), noticeHeld(attempt))

export const emptyWait = (attempt: number): Effect.Effect<TranscriptViewEvent> =>
  Effect.as(Effect.sleep(NOTICE_DELAY), emptyDue(attempt))

export const sameOnScreen = (one: TranscriptViewState, other: TranscriptViewState): boolean =>
  caseName(TranscriptViewState, one) === caseName(TranscriptViewState, other) &&
  Option.getOrUndefined(shownOf(one)) === Option.getOrUndefined(shownOf(other)) &&
  Option.getOrUndefined(threadSessionOf(one)) === Option.getOrUndefined(threadSessionOf(other)) &&
  Option.getOrUndefined(failureOf(one)) === Option.getOrUndefined(failureOf(other)) &&
  skillsOf(one) === skillsOf(other)
