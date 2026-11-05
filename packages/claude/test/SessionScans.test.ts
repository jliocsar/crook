import { expect, layer } from '@effect/vitest'
import * as Context from 'effect/Context'
import * as Deferred from 'effect/Deferred'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as HashMap from 'effect/HashMap'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as Ref from 'effect/Ref'
import * as Stream from 'effect/Stream'

import { SessionScans } from '@crook/claude/SessionScans'
import { TranscriptFile } from '@crook/claude/TranscriptLocator'
import { TranscriptTail } from '@crook/claude/TranscriptTail'

import { SESSION, watchedPlatform } from './Fixtures'

const TOOL_USE = 'toolu_01NOTICE'
const LATER_TOOL_USE = 'toolu_02NOTICE'

const noticeLine = (toolUse: string) =>
  `${JSON.stringify({
    type: 'user',
    timestamp: '2026-09-28T18:01:06.315Z',
    message: {
      content: `<task-notification>\n<task-id>task</task-id>\n<tool-use-id>${toolUse}</tool-use-id>\n<status>completed</status>\n<summary>done</summary>\n</task-notification>`,
    },
  })}\n`

const scansCountingReads = (reads: Ref.Ref<number>) => {
  const countingTail = Layer.effect(
    TranscriptTail,
    Effect.map(TranscriptTail, (tail) =>
      TranscriptTail.of({
        ...tail,
        followWith: (file, from, parse) =>
          Stream.unwrap(
            Effect.as(
              Ref.update(reads, (count) => count + 1),
              tail.followWith(file, from, parse),
            ),
          ),
      }),
    ),
  ).pipe(Layer.provide(TranscriptTail.layer))

  return Layer.provide(SessionScans.layer, countingTail)
}

const setUp = Effect.fn('setUp')(function* () {
  const fileSystem = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const directory = yield* fileSystem.makeTempDirectoryScoped()
  const file = new TranscriptFile({
    session: SESSION,
    path: path.join(directory, `${SESSION}.jsonl`),
  })
  const reads = yield* Ref.make(0)
  const context = yield* Layer.build(scansCountingReads(reads))

  yield* fileSystem.writeFileString(file.path, noticeLine(TOOL_USE))

  return { file, reads, scans: Context.get(context, SessionScans), fileSystem }
})

layer(watchedPlatform, { excludeTestServices: true })('SessionScans', (live) => {
  live.effect('reads a session once for all who watch, and a late one starts from the scan', () =>
    Effect.gen(function* () {
      const { file, reads, scans, fileSystem } = yield* setUp()
      const firstSaw = yield* Deferred.make<void>()
      const laterNotice = yield* Deferred.make<void>()

      yield* scans.follow(file).pipe(
        Stream.runForEach((scan) =>
          Effect.gen(function* () {
            yield* Deferred.succeed(firstSaw, undefined)

            if (HashMap.has(scan.notices, LATER_TOOL_USE)) {
              yield* Deferred.succeed(laterNotice, undefined)
            }
          }),
        ),
        Effect.forkScoped,
      )

      yield* Deferred.await(firstSaw)

      const lateScan = yield* scans
        .follow(file)
        .pipe(Stream.runHead, Effect.flatMap(Effect.fromOption))

      yield* fileSystem.writeFileString(file.path, noticeLine(LATER_TOOL_USE), { flag: 'a' })
      yield* Deferred.await(laterNotice)

      expect(HashMap.has(lateScan.notices, TOOL_USE)).toBe(true)
      expect(yield* Ref.get(reads)).toBe(1)
    }).pipe(Effect.scoped),
  )

  live.effect('stops reading once nobody watches, and reads the whole file for the next', () =>
    Effect.gen(function* () {
      const { file, reads, scans } = yield* setUp()
      const firstScan = yield* scans.follow(file).pipe(Stream.runHead)
      const nextScan = yield* scans.follow(file).pipe(Stream.runHead)

      expect(yield* Ref.get(reads)).toBe(2)
      expect(Option.map(nextScan, (scan) => HashMap.has(scan.notices, TOOL_USE))).toEqual(
        Option.some(true),
      )
      expect(Option.isSome(firstScan)).toBe(true)
    }).pipe(Effect.scoped),
  )
})
