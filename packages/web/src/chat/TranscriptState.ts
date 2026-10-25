import * as Data from 'effect/Data'
import { pipe } from 'effect/Function'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Struct from 'effect/Struct'

import type { ClaudeSessionId } from '@crook/domain/Ids'
import type { SkillListing } from '@crook/domain/Skill'
import type { Subagent } from '@crook/domain/Subagent'
import {
  positionAfter,
  remainderAfter,
  type TranscriptEvent,
  type TranscriptPosition,
  type TranscriptTailBytes,
} from '@crook/domain/Transcript'
import type { TranscriptMessage } from '@crook/domain/TranscriptMessage'
import type { HubCallDefected, WatchTranscriptRefused } from '@crook/web/rpc/HubConnection'
import type { TranscriptResume } from '@crook/web/rpc/HubLink'

export type TranscriptLine = Data.TaggedEnum<{
  Message: { readonly session: ClaudeSessionId; readonly message: TranscriptMessage }
  SessionCleared: { readonly session: ClaudeSessionId }
}>

export type TranscriptWatchFailure = WatchTranscriptRefused | HubCallDefected

export const TranscriptLine = Data.taggedEnum<TranscriptLine>()

export class TranscriptView extends Data.Class<{
  readonly position: Option.Option<TranscriptPosition>
  readonly lines: readonly TranscriptLine[]
  readonly subagents: readonly Subagent[]
  readonly skills: readonly SkillListing[]
  readonly catchingUp: boolean
  readonly failure: Option.Option<TranscriptWatchFailure>
}> {}

export const EMPTY_TRANSCRIPT = new TranscriptView({
  position: Option.none(),
  lines: [],
  subagents: [],
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

const freshLines = (view: TranscriptView, event: TranscriptEvent): readonly TranscriptLine[] =>
  Match.value(event).pipe(
    Match.tagsExhaustive({
      TranscriptOpened: (opened) =>
        isOpened(view) ? [TranscriptLine.SessionCleared({ session: opened.session })] : [],
      TranscriptChunk: (chunk) =>
        chunk.messages.map((message) =>
          TranscriptLine.Message({ session: chunk.session, message }),
        ),
      SubagentsChanged: () => [],
      SkillsChanged: () => [],
      TranscriptCaughtUp: () => [],
    }),
  )

const subagentsAfter = (view: TranscriptView, event: TranscriptEvent): readonly Subagent[] =>
  Match.value(event).pipe(
    Match.tagsExhaustive({
      TranscriptOpened: () => [],
      TranscriptChunk: () => view.subagents,
      SubagentsChanged: (changed) => changed.subagents,
      SkillsChanged: () => view.subagents,
      TranscriptCaughtUp: () => view.subagents,
    }),
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

const recovered = (view: TranscriptView): TranscriptView =>
  Option.isNone(view.failure)
    ? view
    : new TranscriptView(Struct.evolve(view, { failure: () => Option.none() }))

export const applyTranscriptEvent = (
  view: TranscriptView,
  event: TranscriptEvent,
): TranscriptView =>
  pipe(
    remainderAfter(view.position, event),
    Option.match({
      onNone: () => recovered(view),
      onSome: (fresh) =>
        new TranscriptView({
          position: positionAfter(view.position, fresh),
          lines: [...view.lines, ...freshLines(view, fresh)],
          subagents: subagentsAfter(view, fresh),
          skills: skillsAfter(view, fresh),
          catchingUp: catchingUpAfter(view, fresh),
          failure: Option.none(),
        }),
    }),
  )

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

export const linesOf = (view: Option.Option<TranscriptView>): readonly TranscriptLine[] =>
  Option.match(view, { onNone: () => [], onSome: (found) => found.lines })

export const subagentsOf = (view: Option.Option<TranscriptView>): readonly Subagent[] =>
  Option.match(view, { onNone: () => [], onSome: (found) => found.subagents })

export const skillsOf = (view: Option.Option<TranscriptView>): readonly SkillListing[] =>
  Option.match(view, { onNone: () => [], onSome: (found) => found.skills })
