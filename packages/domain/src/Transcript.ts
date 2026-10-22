import * as Arr from 'effect/Array'
import { pipe } from 'effect/Function'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'

import { ClaudeSessionId, PaneId, SubagentId, TranscriptOffset } from '@crook/domain/Ids'
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

export class TranscriptCaughtUp extends Schema.TaggedClass<TranscriptCaughtUp>()(
  'TranscriptCaughtUp',
  { session: ClaudeSessionId, offset: TranscriptOffset },
) {}

export const TranscriptEvent = Schema.Union([
  TranscriptOpened,
  TranscriptChunk,
  SubagentsChanged,
  TranscriptCaughtUp,
])
export type TranscriptEvent = typeof TranscriptEvent.Type

export const TRANSCRIPT_START = TranscriptOffset.make(0)

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
      TranscriptCaughtUp: () => position,
    }),
  )

const inSession = (position: Option.Option<TranscriptPosition>, session: ClaudeSessionId) =>
  Option.exists(position, (current) => current.session === session)

const messageAfter = (
  message: TranscriptMessage,
  from: TranscriptOffset,
): Option.Option<TranscriptMessage> =>
  Match.value(message).pipe(
    Match.tag('Omitted', (omitted) =>
      omitted.offset >= from
        ? Option.some(omitted)
        : pipe(
            Option.liftPredicate(
              omitted.offset + omitted.byteLength - from,
              (byteLength) => byteLength > 0,
            ),
            Option.map((byteLength) => new OmittedLines({ offset: from, byteLength })),
          ),
    ),
    Match.orElse((other) => Option.liftPredicate(other, ({ offset }) => offset >= from)),
  )

const chunkRemainder = (
  position: Option.Option<TranscriptPosition>,
  chunk: TranscriptChunk,
): Option.Option<TranscriptEvent> =>
  pipe(
    position,
    Option.filter(
      (current) =>
        current.session === chunk.session &&
        chunk.offset <= current.offset &&
        current.offset < chunk.nextOffset,
    ),
    Option.map((current) =>
      current.offset === chunk.offset
        ? chunk
        : new TranscriptChunk({
            session: chunk.session,
            offset: current.offset,
            nextOffset: chunk.nextOffset,
            messages: pipe(
              chunk.messages,
              Arr.map((message) => messageAfter(message, current.offset)),
              Arr.getSomes,
            ),
          }),
    ),
  )

export const remainderAfter = (
  position: Option.Option<TranscriptPosition>,
  event: TranscriptEvent,
): Option.Option<TranscriptEvent> =>
  Match.value(event).pipe(
    Match.tagsExhaustive({
      TranscriptOpened: (opened) =>
        Option.liftPredicate(opened, ({ session }) => !inSession(position, session)),
      TranscriptChunk: (chunk) => chunkRemainder(position, chunk),
      SubagentsChanged: (changed) =>
        Option.liftPredicate(changed, ({ session }) => inSession(position, session)),
      TranscriptCaughtUp: (caughtUp) =>
        Option.liftPredicate(caughtUp, ({ session }) => inSession(position, session)),
    }),
  )
