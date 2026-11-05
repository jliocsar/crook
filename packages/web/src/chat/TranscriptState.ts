import * as Arr from 'effect/Array'
import * as Data from 'effect/Data'
import type * as DateTime from 'effect/DateTime'
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
import type { TranscriptResume } from '@crook/web/rpc/HubLink'

export interface TranscriptLine {
  readonly session: ClaudeSessionId
  readonly message: TranscriptMessage
}

export interface Lapse {
  readonly from: DateTime.Utc
  readonly to: DateTime.Utc
}

export type SessionRosters = HashMap.HashMap<ClaudeSessionId, readonly Subagent[]>

export type SessionBackgrounds = HashMap.HashMap<ClaudeSessionId, BackgroundChanged>

export type LaptopCatchUp = Data.TaggedEnum<{
  None: Record<never, never>
  Pending: { readonly lines: readonly TranscriptLine[] }
  Landed: { readonly lapse: Option.Option<Lapse> }
}>

export const LaptopCatchUp = Data.taggedEnum<LaptopCatchUp>()

export class TranscriptView extends Data.Class<{
  readonly position: Option.Option<TranscriptPosition>
  readonly lines: readonly TranscriptLine[]
  readonly rosters: SessionRosters
  readonly backgrounds: SessionBackgrounds
  readonly skills: readonly SkillListing[]
  readonly whole: boolean
  readonly catchUp: LaptopCatchUp
}> {}

export const NO_ROSTERS: SessionRosters = HashMap.empty()
export const NO_BACKGROUNDS: SessionBackgrounds = HashMap.empty()
export const NO_CATCH_UP = LaptopCatchUp.None()

export const EMPTY_TRANSCRIPT = new TranscriptView({
  position: Option.none(),
  lines: [],
  rosters: NO_ROSTERS,
  backgrounds: NO_BACKGROUNDS,
  skills: [],
  whole: false,
  catchUp: NO_CATCH_UP,
})

export const isOpened = (view: TranscriptView): boolean => Option.isSome(view.position)

export const hasLines = (view: TranscriptView): boolean => Arr.isReadonlyArrayNonEmpty(view.lines)

export const opensAnotherSession = (
  position: Option.Option<TranscriptPosition>,
  event: TranscriptEvent,
): boolean =>
  Match.value(event).pipe(
    Match.tag(
      'TranscriptOpened',
      (opened) => Option.isSome(position) && !inSession(position, opened.session),
    ),
    Match.orElse(() => false),
  )

const withoutSession = (view: TranscriptView): TranscriptView =>
  new TranscriptView(
    Struct.evolve(view, {
      lines: () => [],
      rosters: () => NO_ROSTERS,
      backgrounds: () => NO_BACKGROUNDS,
      whole: () => false,
      catchUp: () => NO_CATCH_UP,
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

export const applyTranscriptEvent = (
  view: TranscriptView,
  event: TranscriptEvent,
): TranscriptView => {
  const current = opensAnotherSession(view.position, event) ? withoutSession(view) : view

  return new TranscriptView({
    position: positionAfter(current.position, event),
    lines: [...current.lines, ...freshLines(event)],
    rosters: rostersAfter(current, event),
    backgrounds: backgroundsAfter(current, event),
    skills: skillsAfter(current, event),
    whole: current.whole,
    catchUp: current.catchUp,
  })
}

export const withoutPendingCatchUp = (view: TranscriptView): TranscriptView =>
  LaptopCatchUp.$is('Pending')(view.catchUp)
    ? new TranscriptView(Struct.evolve(view, { catchUp: () => NO_CATCH_UP }))
    : view

export const readAgain = (view: TranscriptView, whole: boolean): TranscriptView =>
  new TranscriptView(
    Struct.evolve(EMPTY_TRANSCRIPT, {
      skills: () => view.skills,
      whole: () => whole,
      catchUp: () => withoutPendingCatchUp(view).catchUp,
    }),
  )

export const resumeOf = (
  view: TranscriptView,
  tail: Option.Option<TranscriptTailBytes>,
): TranscriptResume => ({ from: view.position, tail: view.whole ? Option.none() : tail })

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
