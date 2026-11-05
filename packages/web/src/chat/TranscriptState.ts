import * as Arr from 'effect/Array'
import * as Data from 'effect/Data'
import { pipe } from 'effect/Function'
import * as HashMap from 'effect/HashMap'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Struct from 'effect/Struct'

import type { ClaudeSessionId } from '@crook/domain/Ids'
import type { SkillListing } from '@crook/domain/Skill'
import type { Subagent } from '@crook/domain/Subagent'
import {
  type BackgroundChanged,
  inSession,
  positionAfter,
  type TranscriptEvent,
  type TranscriptPosition,
  type TranscriptTailBytes,
} from '@crook/domain/Transcript'
import type { TranscriptMessage } from '@crook/domain/TranscriptMessage'
import type { HubCallDefected, WatchTranscriptRefused } from '@crook/web/rpc/HubConnection'
import type { TranscriptResume } from '@crook/web/rpc/HubLink'

export interface TranscriptLine {
  readonly session: ClaudeSessionId
  readonly message: TranscriptMessage
}

export type TranscriptWatchFailure = WatchTranscriptRefused | HubCallDefected

export type SessionRosters = HashMap.HashMap<ClaudeSessionId, readonly Subagent[]>

export type SessionBackgrounds = HashMap.HashMap<ClaudeSessionId, BackgroundChanged>

export class TranscriptView extends Data.Class<{
  readonly position: Option.Option<TranscriptPosition>
  readonly lines: readonly TranscriptLine[]
  readonly rosters: SessionRosters
  readonly backgrounds: SessionBackgrounds
  readonly skills: readonly SkillListing[]
  readonly catchingUp: boolean
  readonly failure: Option.Option<TranscriptWatchFailure>
}> {}

export const NO_ROSTERS: SessionRosters = HashMap.empty()
export const NO_BACKGROUNDS: SessionBackgrounds = HashMap.empty()

export const EMPTY_TRANSCRIPT = new TranscriptView({
  position: Option.none(),
  lines: [],
  rosters: NO_ROSTERS,
  backgrounds: NO_BACKGROUNDS,
  skills: [],
  catchingUp: false,
  failure: Option.none(),
})

export const isOpened = (view: TranscriptView): boolean => Option.isSome(view.position)

export const isShowable = (view: TranscriptView): boolean =>
  (isOpened(view) && !view.catchingUp) || Option.isSome(view.failure)

export const catchingUpFrom = (view: TranscriptView, awaitsCaughtUp: boolean): TranscriptView =>
  new TranscriptView(Struct.evolve(view, { catchingUp: () => awaitsCaughtUp }))

export const shownAfter = (
  shown: Option.Option<TranscriptView>,
  view: TranscriptView,
): readonly [Option.Option<TranscriptView>, readonly TranscriptView[]] =>
  pipe(
    Option.liftPredicate(view, isShowable),
    Option.orElse(() =>
      pipe(
        shown,
        Option.filter((last) => !last.catchingUp),
        Option.map((last) => catchingUpFrom(last, true)),
      ),
    ),
    Option.match({
      onNone: () => [shown, []],
      onSome: (next) => [Option.some(next), [next]],
    }),
  )

const opensAnotherSession = (view: TranscriptView, event: TranscriptEvent): boolean =>
  Match.value(event).pipe(
    Match.tag('TranscriptOpened', (opened) => !inSession(view.position, opened.session)),
    Match.orElse(() => false),
  )

const withoutSession = (view: TranscriptView): TranscriptView =>
  new TranscriptView(
    Struct.evolve(view, {
      lines: () => [],
      rosters: () => NO_ROSTERS,
      backgrounds: () => NO_BACKGROUNDS,
    }),
  )

const freshLines = (event: TranscriptEvent): readonly TranscriptLine[] =>
  Match.value(event).pipe(
    Match.tag('TranscriptChunk', (chunk) =>
      Arr.map(chunk.messages, (message) => ({ session: chunk.session, message })),
    ),
    Match.orElse(() => []),
  )

const rostersAfter = (view: TranscriptView, event: TranscriptEvent): SessionRosters =>
  Match.value(event).pipe(
    Match.tagsExhaustive({
      TranscriptOpened: () => view.rosters,
      TranscriptChunk: () => view.rosters,
      SubagentsChanged: (changed) => HashMap.set(view.rosters, changed.session, changed.subagents),
      SkillsChanged: () => view.rosters,
      TranscriptCaughtUp: () => view.rosters,
      BackgroundChanged: () => view.rosters,
    }),
  )

const backgroundsAfter = (view: TranscriptView, event: TranscriptEvent): SessionBackgrounds =>
  Match.value(event).pipe(
    Match.tag('BackgroundChanged', (changed) =>
      HashMap.set(view.backgrounds, changed.session, changed),
    ),
    Match.orElse(() => view.backgrounds),
  )

const skillsAfter = (view: TranscriptView, event: TranscriptEvent): readonly SkillListing[] =>
  Match.value(event).pipe(
    Match.tag('SkillsChanged', (changed) => changed.skills),
    Match.orElse(() => view.skills),
  )

const catchingUpAfter = (view: TranscriptView, event: TranscriptEvent): boolean =>
  Match.value(event).pipe(
    Match.tag('TranscriptCaughtUp', () => false),
    Match.orElse(() => view.catchingUp),
  )

export const applyTranscriptEvent = (
  view: TranscriptView,
  event: TranscriptEvent,
): TranscriptView => {
  const current = opensAnotherSession(view, event) ? withoutSession(view) : view

  return new TranscriptView({
    position: positionAfter(current.position, event),
    lines: [...current.lines, ...freshLines(event)],
    rosters: rostersAfter(current, event),
    backgrounds: backgroundsAfter(current, event),
    skills: skillsAfter(current, event),
    catchingUp: catchingUpAfter(current, event),
    failure: Option.none(),
  })
}

export const failedWith = (view: TranscriptView, failure: TranscriptWatchFailure): TranscriptView =>
  new TranscriptView(
    Struct.evolve(view, { catchingUp: () => false, failure: () => Option.some(failure) }),
  )

export const resumeOf = (
  view: TranscriptView,
  tail: Option.Option<TranscriptTailBytes>,
): TranscriptResume => ({ from: view.position, tail })

export const isCatchingUp = (view: Option.Option<TranscriptView>): boolean =>
  Option.exists(view, (found) => found.catchingUp)

export const hasFailed = (view: Option.Option<TranscriptView>): boolean =>
  Option.exists(view, (found) => Option.isSome(found.failure))

export const linesOf = (view: Option.Option<TranscriptView>): readonly TranscriptLine[] =>
  Option.match(view, { onNone: () => [], onSome: (found) => found.lines })

export const sessionOf = (view: Option.Option<TranscriptView>): Option.Option<ClaudeSessionId> =>
  pipe(
    view,
    Option.flatMap((found) => found.position),
    Option.map((position) => position.session),
  )

export const rostersOf = (view: Option.Option<TranscriptView>): SessionRosters =>
  Option.match(view, { onNone: () => NO_ROSTERS, onSome: (found) => found.rosters })

export const backgroundsOf = (view: Option.Option<TranscriptView>): SessionBackgrounds =>
  Option.match(view, { onNone: () => NO_BACKGROUNDS, onSome: (found) => found.backgrounds })

export const skillsOf = (view: Option.Option<TranscriptView>): readonly SkillListing[] =>
  Option.match(view, { onNone: () => [], onSome: (found) => found.skills })
