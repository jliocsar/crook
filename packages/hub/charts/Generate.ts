import * as BunFileSystem from '@effect/platform-bun/BunFileSystem'
import * as BunRuntime from '@effect/platform-bun/BunRuntime'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'

import { chartOf, walk } from '@crook/web/machine/Walk'

import { approvalAnswerWalk } from './ApprovalAnswerWalk.ts'

const CHART_FILE = 'charts/approval-answer.mmd'

const generate = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem

  yield* fileSystem.writeFileString(CHART_FILE, chartOf(walk(approvalAnswerWalk)))
  yield* Effect.logInfo(`Wrote ${CHART_FILE}`)
})

// oxlint-disable-next-line effecttsgo/strict-effect-provide
BunRuntime.runMain(generate.pipe(Effect.provide(BunFileSystem.layer)))
