import * as BunFileSystem from '@effect/platform-bun/BunFileSystem'
import { expect, layer } from '@effect/vitest'
import * as Context from 'effect/Context'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as Schema from 'effect/Schema'
import * as Stream from 'effect/Stream'

import { ClaudeSessionFiles, SessionFile } from '@crook/agent/ClaudeSessionFiles'
import { FileWatch } from '@crook/claude/FileWatch'
import { ClaudeSessionId } from '@crook/domain/Ids'

const SESSION = ClaudeSessionId.make('cc70b540-d22a-4ea4-aaf9-a0db3ce151aa')
const CLEARED = ClaudeSessionId.make('5f0c2a8e-91d4-4b6e-a3c7-2e8d6b1f4a90')
const PID = 2224797
const NOTHING_MOVED_WAIT = Duration.millis(150)
const MOVE_WAIT = Duration.seconds(5)

const encodeSessionFile = Schema.encodeSync(SessionFile)

const sessionFile = (session: ClaudeSessionId) =>
  encodeSessionFile({ pid: PID, sessionId: session, procStart: '248837515' })

const services = Layer.mergeAll(BunFileSystem.layer, Path.layer)

const watchingRoots = Effect.fn('watchingRoots')(function* (roots: readonly string[]) {
  const context = yield* Layer.build(
    ClaudeSessionFiles.layerAt(roots).pipe(
      Layer.provide(Layer.provideMerge(FileWatch.layer, services)),
    ),
  )

  return Context.get(context, ClaudeSessionFiles)
})

const awaitMove = (files: ClaudeSessionFiles['Service']) =>
  files.changes.pipe(
    Stream.runHead,
    Effect.timeoutOrElse({ duration: MOVE_WAIT, orElse: () => Effect.succeedNone }),
    Effect.map(Option.isSome),
  )

const staysStill = (files: ClaudeSessionFiles['Service']) =>
  files.changes.pipe(
    Stream.runHead,
    Effect.timeoutOrElse({
      duration: NOTHING_MOVED_WAIT,
      orElse: () => Effect.succeedNone,
    }),
    Effect.map(Option.isNone),
  )

const rootWithSession = Effect.fn('rootWithSession')(function* (session: ClaudeSessionId) {
  const fileSystem = yield* FileSystem.FileSystem
  const root = yield* fileSystem.makeTempDirectoryScoped()

  yield* fileSystem.makeDirectory(`${root}/sessions`)
  yield* fileSystem.writeFileString(`${root}/sessions/${PID}.json`, sessionFile(session))

  return root
})

layer(services, { excludeTestServices: true })('ClaudeSessionFiles', (it) => {
  it.effect('says so when a pid file comes to name another session', () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const root = yield* rootWithSession(SESSION)
      const files = yield* watchingRoots([root])

      expect(yield* awaitMove(files)).toBe(true)
      expect(yield* files.holds(SESSION)).toBe(true)

      yield* fileSystem.writeFileString(`${root}/sessions/${PID}.json`, sessionFile(CLEARED))

      expect(yield* awaitMove(files)).toBe(true)
      expect(yield* files.holds(CLEARED)).toBe(true)
      expect(yield* files.holds(SESSION)).toBe(false)
    }),
  )

  it.effect('stays still when a pid file is rewritten under the same session', () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const root = yield* rootWithSession(SESSION)
      const files = yield* watchingRoots([root])

      yield* awaitMove(files)
      yield* fileSystem.writeFileString(`${root}/sessions/${PID}.json`, sessionFile(SESSION))

      expect(yield* staysStill(files)).toBe(true)
    }),
  )

  it.effect('ignores the other files Claude keeps beside its pid files', () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const root = yield* rootWithSession(SESSION)
      const files = yield* watchingRoots([root])

      yield* awaitMove(files)
      yield* fileSystem.writeFileString(`${root}/sessions/${PID}.abc.key`, sessionFile(CLEARED))
      yield* fileSystem.writeFileString(`${root}/sessions/${PID}.abc.key.tmp.1`, 'not a session')

      expect(yield* staysStill(files)).toBe(true)
      expect(yield* files.holds(CLEARED)).toBe(false)
    }),
  )

  it.effect('waits out a half-written pid file and takes the finished one', () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const root = yield* rootWithSession(SESSION)
      const files = yield* watchingRoots([root])

      yield* awaitMove(files)
      yield* fileSystem.writeFileString(`${root}/sessions/${PID}.json`, '{"pid":')

      expect(yield* staysStill(files)).toBe(true)
      expect(yield* files.holds(SESSION)).toBe(true)

      yield* fileSystem.writeFileString(`${root}/sessions/${PID}.json`, sessionFile(CLEARED))

      expect(yield* awaitMove(files)).toBe(true)
    }),
  )

  it.effect('says so when a pid file goes, and forgets its session', () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const root = yield* rootWithSession(SESSION)
      const files = yield* watchingRoots([root])

      yield* awaitMove(files)
      yield* fileSystem.remove(`${root}/sessions/${PID}.json`)

      expect(yield* awaitMove(files)).toBe(true)
      expect(yield* files.holds(SESSION)).toBe(false)
    }),
  )

  it.effect('notices the sessions folder when Claude makes it after the agent started', () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const root = yield* fileSystem.makeTempDirectoryScoped()
      const files = yield* watchingRoots([`${root}/not-yet/made`])

      expect(yield* staysStill(files)).toBe(true)

      yield* fileSystem.makeDirectory(`${root}/not-yet/made/sessions`, { recursive: true })
      yield* fileSystem.writeFileString(
        `${root}/not-yet/made/sessions/${PID}.json`,
        sessionFile(SESSION),
      )

      expect(yield* awaitMove(files)).toBe(true)
      expect(yield* files.holds(SESSION)).toBe(true)
    }),
  )

  it.effect('keeps hearing a sessions folder that was deleted and made again', () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const root = yield* rootWithSession(SESSION)
      const files = yield* watchingRoots([root])

      yield* awaitMove(files)
      yield* fileSystem.remove(`${root}/sessions`, { recursive: true })

      expect(yield* awaitMove(files)).toBe(true)
      expect(yield* staysStill(files)).toBe(true)

      yield* fileSystem.makeDirectory(`${root}/sessions`)
      yield* fileSystem.writeFileString(`${root}/sessions/${PID}.json`, sessionFile(CLEARED))

      expect(yield* awaitMove(files)).toBe(true)
      expect(yield* files.holds(CLEARED)).toBe(true)
    }),
  )

  it.effect('keeps the other roots going when one cannot be watched, and retries that one', () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const locked = yield* rootWithSession(SESSION)
      const open = yield* rootWithSession(CLEARED)

      yield* fileSystem.chmod(`${locked}/sessions`, 0)

      const files = yield* watchingRoots([locked, open])

      expect(yield* awaitMove(files)).toBe(true)
      expect(yield* files.holds(CLEARED)).toBe(true)
      expect(yield* files.holds(SESSION)).toBe(false)

      yield* fileSystem.chmod(`${locked}/sessions`, 0o755)

      expect(yield* awaitMove(files)).toBe(true)
      expect(yield* files.holds(SESSION)).toBe(true)
    }),
  )
})
