import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'
import * as RcMap from 'effect/RcMap'
import * as Stream from 'effect/Stream'

import {
  type BackgroundLedger,
  EMPTY_LEDGER,
  backgroundLines,
  withBackgroundLines,
} from '@crook/claude/BackgroundTasks'
import { NO_TASK_NOTICES, type TaskNotices, withTaskNotices } from '@crook/claude/TaskNotices'
import type { TranscriptFile } from '@crook/claude/TranscriptLocator'
import { type TailError, type TailEvent, TranscriptTail } from '@crook/claude/TranscriptTail'
import { TRANSCRIPT_START } from '@crook/domain/Transcript'

export interface SessionScan {
  readonly notices: TaskNotices
  readonly ledger: BackgroundLedger
}

interface ScanProgress extends SessionScan {
  readonly caughtUp: boolean
}

const NO_SCAN: ScanProgress = { notices: NO_TASK_NOTICES, ledger: EMPTY_LEDGER, caughtUp: false }

const scanAfter = (scan: ScanProgress, event: TailEvent): ScanProgress =>
  Match.value(event).pipe(
    Match.tagsExhaustive({
      TranscriptChunk: (chunk) => ({
        notices: withTaskNotices(scan.notices, chunk.messages),
        ledger: withBackgroundLines(scan.ledger, chunk.messages),
        caughtUp: scan.caughtUp,
      }),
      TranscriptCaughtUp: () => ({ ...scan, caughtUp: true }),
    }),
  )

const make = Effect.gen(function* () {
  const tail = yield* TranscriptTail

  const scansOf = (file: TranscriptFile): Stream.Stream<SessionScan, TailError> =>
    tail.followWith(file, TRANSCRIPT_START, backgroundLines).pipe(
      Stream.scan(() => NO_SCAN, scanAfter),
      Stream.filter((scan) => scan.caughtUp),
    )

  const shared = yield* RcMap.make({
    lookup: (file: TranscriptFile) =>
      Stream.share(scansOf(file), { capacity: 'unbounded', replay: 1 }),
  })

  return SessionScans.of({
    follow: (file) => Stream.unwrap(RcMap.get(shared, file)),
  })
})

export class SessionScans extends Context.Service<
  SessionScans,
  {
    readonly follow: (file: TranscriptFile) => Stream.Stream<SessionScan, TailError>
  }
>()('@crook/claude/SessionScans') {
  static readonly layer = Layer.effect(this, make)
}
