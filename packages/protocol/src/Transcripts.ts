import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'

import { ClaudeSessionId } from '@crook/domain/Ids'
import {
  TranscriptEvent,
  TranscriptPosition,
  TranscriptSource,
  TranscriptTailBytes,
} from '@crook/domain/Transcript'

export const TranscriptWatchId = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).pipe(
  Schema.brand('TranscriptWatchId'),
)
export type TranscriptWatchId = typeof TranscriptWatchId.Type

export class TranscriptWatch extends Schema.Class<TranscriptWatch>('TranscriptWatch')({
  id: TranscriptWatchId,
  source: TranscriptSource,
  from: Schema.OptionFromNullOr(TranscriptPosition),
  tail: Schema.OptionFromNullOr(TranscriptTailBytes),
}) {}

export class TranscriptDemand extends Schema.Class<TranscriptDemand>('TranscriptDemand')({
  watches: Schema.Array(TranscriptWatch),
}) {}

export class TranscriptReadFailed extends Schema.TaggedError<TranscriptReadFailed>()(
  'TranscriptReadFailed',
  { detail: Schema.String },
) {
  override get message(): string {
    return "The agent could not read this transcript. Try again; if it keeps failing, the agent's log on that machine says why."
  }
}

export class TranscriptResumeRejected extends Schema.TaggedError<TranscriptResumeRejected>()(
  'TranscriptResumeRejected',
  { detail: Schema.String },
) {
  override get message(): string {
    return 'The transcript cannot resume where this screen left off. Try again to read it from the start.'
  }
}

export class TranscriptSessionRejected extends Schema.TaggedError<TranscriptSessionRejected>()(
  'TranscriptSessionRejected',
  { session: ClaudeSessionId },
) {
  override get message(): string {
    return 'The agent will not look up this session: it only reads ids made of letters, digits and dashes. Open the chat from the herd again.'
  }
}

export const TranscriptFailure = Schema.Union([
  TranscriptReadFailed,
  TranscriptResumeRejected,
  TranscriptSessionRejected,
])
export type TranscriptFailure = typeof TranscriptFailure.Type

export class TranscriptWatchFailed extends Schema.TaggedClass<TranscriptWatchFailed>()(
  'TranscriptWatchFailed',
  { failure: TranscriptFailure },
) {}

export const isWatchFailed = Schema.is(TranscriptWatchFailed)

export const TranscriptUpdate = Schema.Union([...TranscriptEvent.members, TranscriptWatchFailed])
export type TranscriptUpdate = typeof TranscriptUpdate.Type

export class TranscriptOutOfStep extends Schema.TaggedError<TranscriptOutOfStep>()(
  'TranscriptOutOfStep',
  { watch: TranscriptWatchId, expected: Schema.OptionFromNullOr(TranscriptPosition) },
) {
  override get message(): string {
    return Option.match(this.expected, {
      onNone: () =>
        `Transcript watch ${this.watch} got a chunk before the session it belongs to was opened. The agent starts the watch again from the beginning.`,
      onSome: (expected) =>
        `Transcript watch ${this.watch} got a chunk that does not start at byte ${expected.offset} of session ${expected.session}, where the last one ended. The agent starts the watch again from there.`,
    })
  }
}
