import * as Data from 'effect/Data'
import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import * as Atom from 'effect/reactivity/Atom'
import * as Stream from 'effect/Stream'
import * as SubscriptionRef from 'effect/SubscriptionRef'

import type { ClaudeSessionId, MachineId, PaneId, SubagentId } from '@crook/domain/Ids'
import {
  PaneTranscript,
  SubagentTranscript,
  TranscriptTailBytes,
  type TranscriptSource,
} from '@crook/domain/Transcript'
import { hubRuntime } from '@crook/web/atoms/Hub'
import {
  applyTranscriptEvent,
  EMPTY_TRANSCRIPT,
  failedWith,
  resumeOf,
} from '@crook/web/chat/TranscriptState'
import { HubLink } from '@crook/web/rpc/HubLink'

export const CHAT_OPEN_TAIL = TranscriptTailBytes.make(512 * 1024)

export class PaneTranscriptKey extends Data.Class<{
  readonly machine: MachineId
  readonly pane: PaneId
  readonly whole: boolean
}> {}

export class SubagentTranscriptKey extends Data.Class<{
  readonly machine: MachineId
  readonly session: ClaudeSessionId
  readonly subagent: SubagentId
  readonly whole: boolean
}> {}

const tailFor = (whole: boolean) => (whole ? Option.none() : Option.some(CHAT_OPEN_TAIL))

export const transcriptViews = (machine: MachineId, source: TranscriptSource, whole: boolean) =>
  Stream.unwrap(
    Effect.gen(function* () {
      const link = yield* HubLink
      const view = yield* SubscriptionRef.make(EMPTY_TRANSCRIPT)

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
          Effect.catch((failure) =>
            SubscriptionRef.update(view, (current) => failedWith(current, failure)),
          ),
          Effect.forkScoped,
        )

      return SubscriptionRef.changes(view)
    }),
  )

export const paneTranscriptAtom = Atom.family((key: PaneTranscriptKey) =>
  hubRuntime.atom(transcriptViews(key.machine, new PaneTranscript({ pane: key.pane }), key.whole)),
)

export const subagentTranscriptAtom = Atom.family((key: SubagentTranscriptKey) =>
  hubRuntime.atom(
    transcriptViews(
      key.machine,
      new SubagentTranscript({ session: key.session, subagent: key.subagent }),
      key.whole,
    ),
  ),
)
