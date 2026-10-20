import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'

import { ClaudeSessionId, PaneId, SubagentId, TranscriptOffset } from '@crook/domain/Ids'
import { Subagent } from '@crook/domain/Subagent'
import { TranscriptMessage } from '@crook/domain/TranscriptMessage'

export class TranscriptPosition extends Schema.Class<TranscriptPosition>('TranscriptPosition')({
  session: ClaudeSessionId,
  offset: TranscriptOffset,
}) {}

export class PaneTranscript extends Schema.TaggedClass<PaneTranscript>()('PaneTranscript', {
  pane: PaneId,
}) {}

export class SubagentTranscript extends Schema.TaggedClass<SubagentTranscript>()(
  'SubagentTranscript',
  { session: ClaudeSessionId, subagent: SubagentId },
) {}

export const TranscriptSource = Schema.Union([PaneTranscript, SubagentTranscript])
export type TranscriptSource = typeof TranscriptSource.Type

export class TranscriptOpened extends Schema.TaggedClass<TranscriptOpened>()('TranscriptOpened', {
  session: ClaudeSessionId,
}) {}

export class TranscriptChunk extends Schema.TaggedClass<TranscriptChunk>()('TranscriptChunk', {
  session: ClaudeSessionId,
  offset: TranscriptOffset,
  nextOffset: TranscriptOffset,
  messages: Schema.Array(TranscriptMessage),
}) {}

export class SubagentsChanged extends Schema.TaggedClass<SubagentsChanged>()('SubagentsChanged', {
  session: ClaudeSessionId,
  subagents: Schema.Array(Subagent),
}) {}

export const TranscriptEvent = Schema.Union([TranscriptOpened, TranscriptChunk, SubagentsChanged])
export type TranscriptEvent = typeof TranscriptEvent.Type

export const TRANSCRIPT_START = TranscriptOffset.make(0)

export const continuesFrom = (
  position: Option.Option<TranscriptPosition>,
  chunk: TranscriptChunk,
) =>
  Option.exists(
    position,
    (current) => current.session === chunk.session && current.offset === chunk.offset,
  )

export const positionAfter = (
  position: Option.Option<TranscriptPosition>,
  event: TranscriptEvent,
): Option.Option<TranscriptPosition> =>
  Match.value(event).pipe(
    Match.tagsExhaustive({
      TranscriptOpened: (opened) =>
        Option.exists(position, (current) => current.session === opened.session)
          ? position
          : Option.some(
              new TranscriptPosition({ session: opened.session, offset: TRANSCRIPT_START }),
            ),
      TranscriptChunk: (chunk) =>
        Option.some(new TranscriptPosition({ session: chunk.session, offset: chunk.nextOffset })),
      SubagentsChanged: () => position,
    }),
  )
