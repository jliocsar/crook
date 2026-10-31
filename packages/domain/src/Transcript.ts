import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'

import { BackgroundTask, SubagentActivity } from '@crook/domain/Background'
import { ClaudeSessionId, PaneId, SubagentId, TranscriptOffset } from '@crook/domain/Ids'
import { SkillListing } from '@crook/domain/Skill'
import { Subagent } from '@crook/domain/Subagent'
import { OmittedLines, TranscriptMessage } from '@crook/domain/TranscriptMessage'

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

export class SkillsChanged extends Schema.TaggedClass<SkillsChanged>()('SkillsChanged', {
  session: ClaudeSessionId,
  skills: Schema.Array(SkillListing),
}) {}

export class BackgroundChanged extends Schema.TaggedClass<BackgroundChanged>()(
  'BackgroundChanged',
  {
    session: ClaudeSessionId,
    tasks: Schema.Array(BackgroundTask),
    activity: Schema.Array(SubagentActivity),
  },
) {}

export class TranscriptCaughtUp extends Schema.TaggedClass<TranscriptCaughtUp>()(
  'TranscriptCaughtUp',
  { session: ClaudeSessionId, offset: TranscriptOffset },
) {}

export const TranscriptEvent = Schema.Union([
  TranscriptOpened,
  TranscriptChunk,
  SubagentsChanged,
  SkillsChanged,
  BackgroundChanged,
  TranscriptCaughtUp,
])
export type TranscriptEvent = typeof TranscriptEvent.Type

export const TRANSCRIPT_START = TranscriptOffset.make(0)
export const CHUNK_READ_LIMIT = 1024 * 1024

export const TranscriptTailBytes = Schema.Int.check(Schema.isGreaterThan(0)).pipe(
  Schema.brand('TranscriptTailBytes'),
)
export type TranscriptTailBytes = typeof TranscriptTailBytes.Type

export const omittedUpTo = (session: ClaudeSessionId, start: TranscriptOffset) =>
  new TranscriptChunk({
    session,
    offset: TRANSCRIPT_START,
    nextOffset: start,
    messages: [new OmittedLines({ offset: TRANSCRIPT_START, byteLength: start })],
  })

export const continuesFrom = (
  position: Option.Option<TranscriptPosition>,
  chunk: TranscriptChunk,
) =>
  Option.exists(
    position,
    (current) => current.session === chunk.session && current.offset === chunk.offset,
  )

export const inSession = (position: Option.Option<TranscriptPosition>, session: ClaudeSessionId) =>
  Option.exists(position, (current) => current.session === session)

export const positionAfter = (
  position: Option.Option<TranscriptPosition>,
  event: TranscriptEvent,
): Option.Option<TranscriptPosition> =>
  Match.value(event).pipe(
    Match.tagsExhaustive({
      TranscriptOpened: (opened) =>
        inSession(position, opened.session)
          ? position
          : Option.some(
              new TranscriptPosition({ session: opened.session, offset: TRANSCRIPT_START }),
            ),
      TranscriptChunk: (chunk) =>
        Option.some(new TranscriptPosition({ session: chunk.session, offset: chunk.nextOffset })),
      SubagentsChanged: () => position,
      SkillsChanged: () => position,
      BackgroundChanged: () => position,
      TranscriptCaughtUp: () => position,
    }),
  )
