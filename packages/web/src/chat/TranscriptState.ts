import * as Data from 'effect/Data'
import { pipe } from 'effect/Function'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'

import type { ClaudeSessionId } from '@crook/domain/Ids'
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
  readonly failure: Option.Option<TranscriptWatchFailure>
}> {}

export const EMPTY_TRANSCRIPT = new TranscriptView({
  position: Option.none(),
  lines: [],
  subagents: [],
  failure: Option.none(),
})

export const isOpened = (view: TranscriptView): boolean => Option.isSome(view.position)

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
    }),
  )

const subagentsAfter = (view: TranscriptView, event: TranscriptEvent): readonly Subagent[] =>
  Match.value(event).pipe(
    Match.tagsExhaustive({
      TranscriptOpened: () => [],
      TranscriptChunk: () => view.subagents,
      SubagentsChanged: (changed) => changed.subagents,
    }),
  )

const recovered = (view: TranscriptView): TranscriptView =>
  Option.isNone(view.failure)
    ? view
    : new TranscriptView({
        position: view.position,
        lines: view.lines,
        subagents: view.subagents,
        failure: Option.none(),
      })

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
          failure: Option.none(),
        }),
    }),
  )

export const failedWith = (view: TranscriptView, failure: TranscriptWatchFailure): TranscriptView =>
  new TranscriptView({
    position: view.position,
    lines: view.lines,
    subagents: view.subagents,
    failure: Option.some(failure),
  })

export const resumeOf =
  (tail: Option.Option<TranscriptTailBytes>) =>
  (view: TranscriptView): TranscriptResume => ({ from: view.position, tail })

export const linesOf = (view: Option.Option<TranscriptView>): readonly TranscriptLine[] =>
  Option.match(view, { onNone: () => [], onSome: (found) => found.lines })

export const subagentsOf = (view: Option.Option<TranscriptView>): readonly Subagent[] =>
  Option.match(view, { onNone: () => [], onSome: (found) => found.subagents })
