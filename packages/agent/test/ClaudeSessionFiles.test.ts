import * as BunFileSystem from '@effect/platform-bun/BunFileSystem'
import { expect, layer } from '@effect/vitest'
import * as Clock from 'effect/Clock'
import * as Context from 'effect/Context'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as Queue from 'effect/Queue'
import * as Schema from 'effect/Schema'
import * as Stream from 'effect/Stream'

import { ClaudeSessionFiles, PROC_ROOT, SessionFile } from '@crook/agent/ClaudeSessionFiles'
import { FileWatch } from '@crook/claude/FileWatch'
import { ClaudeSessionId } from '@crook/domain/Ids'

const SESSION = ClaudeSessionId.make('cc70b540-d22a-4ea4-aaf9-a0db3ce151aa')
const CLEARED = ClaudeSessionId.make('5f0c2a8e-91d4-4b6e-a3c7-2e8d6b1f4a90')
const PID = 2224797
const DEAD_PID = 2224798
const NOTHING_MOVED_WAIT = Duration.millis(150)
const MOVE_WAIT = Duration.seconds(5)

const encodeSessionFile = Schema.encodeSync(SessionFile)

const PROC_START = '248837515'
const WAITING = 'waiting'
const IDLE = 'idle'
const BUSY = 'busy'

const sessionFile = (session: ClaudeSessionId) =>
  encodeSessionFile({ pid: PID, sessionId: session, procStart: PROC_START })

const fileSaying = (status: string, pid = PID) =>
  encodeSessionFile({ pid, sessionId: SESSION, procStart: PROC_START, status })

const statOf = (procStart: string) =>
  `${PID} (claude) S ${Array.from({ length: 18 }, () => '0').join(' ')} ${procStart} 0`

const services = Layer.mergeAll(BunFileSystem.layer, Path.layer)

const watchingRoots = Effect.fn('watchingRoots')(function* (
  roots: readonly string[],
  procRoot: string = PROC_ROOT,
) {
  const context = yield* Layer.build(
    ClaudeSessionFiles.layerAt(roots, procRoot).pipe(
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

const waitingProbe = Effect.fn('waitingProbe')(function* (firstStatus: string) {
  const fileSystem = yield* FileSystem.FileSystem
  const root = yield* fileSystem.makeTempDirectoryScoped()
  const procRoot = yield* fileSystem.makeTempDirectoryScoped()
  const file = `${root}/sessions/${PID}.json`

  yield* fileSystem.makeDirectory(`${root}/sessions`)
  yield* fileSystem.makeDirectory(`${procRoot}/${PID}`)
  yield* fileSystem.writeFileString(`${procRoot}/${PID}/stat`, statOf(PROC_START))
  yield* fileSystem.writeFileString(file, fileSaying(firstStatus))

  const files = yield* watchingRoots([root], procRoot)

  yield* awaitMove(files)

  return { root, procRoot, file, files, fileSystem }
})

layer(services, { excludeTestServices: true })('ClaudeSessionFiles', (it) => {
  it.effect('reads whether a running Claude waits, and says so when that flips', () =>
    Effect.gen(function* () {
      const { file, files, fileSystem } = yield* waitingProbe(IDLE)

      expect(yield* files.waiting(SESSION)).toEqual(Option.some(false))

      yield* fileSystem.writeFileString(file, fileSaying(WAITING))

      expect(yield* awaitMove(files)).toBe(true)
      expect(yield* files.waiting(SESSION)).toEqual(Option.some(true))

      yield* fileSystem.writeFileString(file, fileSaying(IDLE))

      expect(yield* awaitMove(files)).toBe(true)
      expect(yield* files.waiting(SESSION)).toEqual(Option.some(false))
    }),
  )

  it.effect('marks when a file stops saying waiting, and unmarks when it says so again', () =>
    Effect.gen(function* () {
      const { file, files, fileSystem } = yield* waitingProbe(WAITING)

      expect(yield* files.leftWaitingAt(SESSION)).toEqual(Option.none())

      const before = yield* Clock.currentTimeMillis

      yield* fileSystem.writeFileString(file, fileSaying(IDLE))

      expect(yield* awaitMove(files)).toBe(true)

      const left = yield* files.leftWaitingAt(SESSION)

      expect(Option.exists(left, (at) => at >= before)).toBe(true)

      yield* fileSystem.writeFileString(file, fileSaying(BUSY))

      expect(yield* staysStill(files)).toBe(true)
      expect(yield* files.leftWaitingAt(SESSION)).toEqual(left)

      yield* fileSystem.writeFileString(file, fileSaying(WAITING))

      expect(yield* awaitMove(files)).toBe(true)
      expect(yield* files.leftWaitingAt(SESSION)).toEqual(Option.none())
    }),
  )

  it.effect('marks nothing for a file that never said waiting', () =>
    Effect.gen(function* () {
      const { file, files, fileSystem } = yield* waitingProbe(IDLE)

      yield* fileSystem.writeFileString(file, fileSaying(BUSY))

      expect(yield* staysStill(files)).toBe(true)
      expect(yield* files.leftWaitingAt(SESSION)).toEqual(Option.none())
    }),
  )

  it.effect('marks nothing for a Claude too old to write a status', () =>
    Effect.gen(function* () {
      const root = yield* rootWithSession(SESSION)
      const files = yield* watchingRoots([root])

      yield* awaitMove(files)

      expect(yield* files.leftWaitingAt(SESSION)).toEqual(Option.none())
    }),
  )

  it.effect('marks nothing for a file that loses its status', () =>
    Effect.gen(function* () {
      const { file, files, fileSystem } = yield* waitingProbe(WAITING)

      yield* fileSystem.writeFileString(file, sessionFile(SESSION))

      expect(yield* awaitMove(files)).toBe(true)
      expect(yield* files.leftWaitingAt(SESSION)).toEqual(Option.none())
    }),
  )

  it.effect('marks nothing on a half-written file, then marks the finished one', () =>
    Effect.gen(function* () {
      const { file, files, fileSystem } = yield* waitingProbe(WAITING)

      yield* fileSystem.writeFileString(file, fileSaying(IDLE).slice(0, -10))

      expect(yield* staysStill(files)).toBe(true)
      expect(yield* files.leftWaitingAt(SESSION)).toEqual(Option.none())

      yield* fileSystem.writeFileString(file, fileSaying(IDLE))

      expect(yield* awaitMove(files)).toBe(true)
      expect(Option.isSome(yield* files.leftWaitingAt(SESSION))).toBe(true)
    }),
  )

  it.effect('marks nothing when a killed Claude leaves its file saying waiting', () =>
    Effect.gen(function* () {
      const { procRoot, files, fileSystem } = yield* waitingProbe(WAITING)

      yield* fileSystem.remove(`${procRoot}/${PID}`, { recursive: true })

      expect(yield* staysStill(files)).toBe(true)
      expect(yield* files.leftWaitingAt(SESSION)).toEqual(Option.none())
    }),
  )

  it.effect('marks a file leaving waiting with no /proc to read, off the file alone', () =>
    Effect.gen(function* () {
      const { procRoot, file, files, fileSystem } = yield* waitingProbe(WAITING)

      yield* fileSystem.remove(`${procRoot}/${PID}`, { recursive: true })

      expect(yield* files.waiting(SESSION)).toEqual(Option.some(false))
      expect(yield* files.leftWaitingAt(SESSION)).toEqual(Option.none())

      yield* fileSystem.writeFileString(file, fileSaying(IDLE))

      expect(yield* awaitMove(files)).toBe(true)
      expect(Option.isSome(yield* files.leftWaitingAt(SESSION))).toBe(true)
    }),
  )

  it.effect('marks nothing while another Claude on the session still says waiting', () =>
    Effect.gen(function* () {
      const { root, file, files, fileSystem } = yield* waitingProbe(WAITING)

      yield* fileSystem.writeFileString(
        `${root}/sessions/${DEAD_PID}.json`,
        fileSaying(WAITING, DEAD_PID),
      )
      yield* awaitMove(files)
      yield* fileSystem.writeFileString(file, fileSaying(IDLE))

      yield* awaitMove(files)

      expect(yield* files.leftWaitingAt(SESSION)).toEqual(Option.none())
    }),
  )

  it.effect('stays still when a pid file only goes between busy and idle', () =>
    Effect.gen(function* () {
      const { file, files, fileSystem } = yield* waitingProbe(IDLE)

      yield* fileSystem.writeFileString(file, fileSaying(BUSY))

      expect(yield* staysStill(files)).toBe(true)

      yield* fileSystem.writeFileString(file, fileSaying(IDLE))

      expect(yield* staysStill(files)).toBe(true)
    }),
  )

  it.effect('holds nothing for a pid file a dead process left saying waiting', () =>
    Effect.gen(function* () {
      const { procRoot, files, fileSystem } = yield* waitingProbe(WAITING)

      expect(yield* files.waiting(SESSION)).toEqual(Option.some(true))

      yield* fileSystem.remove(`${procRoot}/${PID}`, { recursive: true })

      expect(yield* files.waiting(SESSION)).toEqual(Option.some(false))
    }),
  )

  it.effect("holds nothing when another process has taken the dead one's pid", () =>
    Effect.gen(function* () {
      const { procRoot, files, fileSystem } = yield* waitingProbe(WAITING)

      yield* fileSystem.writeFileString(`${procRoot}/${PID}/stat`, statOf('999'))

      expect(yield* files.waiting(SESSION)).toEqual(Option.some(false))
    }),
  )

  it.effect('lets a live Claude answer for a session a dead one left waiting', () =>
    Effect.gen(function* () {
      const { root, files, fileSystem } = yield* waitingProbe(IDLE)

      yield* fileSystem.writeFileString(
        `${root}/sessions/${DEAD_PID}.json`,
        fileSaying(WAITING, DEAD_PID),
      )

      expect(yield* awaitMove(files)).toBe(true)
      expect(yield* files.waiting(SESSION)).toEqual(Option.some(false))
    }),
  )

  it.effect("names a session's running Claude, past a pid file a dead one left", () =>
    Effect.gen(function* () {
      const { root, files, fileSystem } = yield* waitingProbe(IDLE)

      yield* fileSystem.writeFileString(
        `${root}/sessions/${DEAD_PID}.json`,
        fileSaying(WAITING, DEAD_PID),
      )

      expect(yield* awaitMove(files)).toBe(true)
      expect(yield* files.runningPid(SESSION)).toEqual(Option.some(PID))
      expect(yield* files.runningPid(CLEARED)).toEqual(Option.none())
    }),
  )

  it.effect('names no process once its pid belongs to another', () =>
    Effect.gen(function* () {
      const { procRoot, files, fileSystem } = yield* waitingProbe(IDLE)

      yield* fileSystem.writeFileString(`${procRoot}/${PID}/stat`, statOf('999'))

      expect(yield* files.runningPid(SESSION)).toEqual(Option.none())
    }),
  )

  it.effect('does not know for a pid file without a status, or a session no file names', () =>
    Effect.gen(function* () {
      const root = yield* rootWithSession(SESSION)
      const files = yield* watchingRoots([root])

      yield* awaitMove(files)

      expect(yield* files.waiting(SESSION)).toEqual(Option.none())
      expect(yield* files.waiting(CLEARED)).toEqual(Option.none())
    }),
  )

  it.effect('stops knowing and says so when Claude removes its pid file while it waits', () =>
    Effect.gen(function* () {
      const { file, files, fileSystem } = yield* waitingProbe(WAITING)

      yield* fileSystem.remove(file)

      expect(yield* awaitMove(files)).toBe(true)
      expect(yield* files.waiting(SESSION)).toEqual(Option.none())
    }),
  )

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
      expect(yield* staysStill(files)).toBe(true)
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

  it.effect('forgets the files of a folder whose own end reached it first', () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const root = yield* rootWithSession(SESSION)
      const events = yield* Queue.unbounded<Option.Option<string>>()
      const watch = Layer.succeed(
        FileWatch,
        FileWatch.of({
          watchReady: () => Stream.fromQueue(events),
          awaitPath: () => Effect.void,
          watchWhenPresent: () => Stream.fromQueue(events),
        }),
      )
      const context = yield* Layer.build(
        ClaudeSessionFiles.layerAt([root]).pipe(Layer.provide(Layer.merge(watch, services))),
      )
      const files = Context.get(context, ClaudeSessionFiles)

      yield* Queue.offer(events, Option.none())

      expect(yield* awaitMove(files)).toBe(true)
      expect(yield* files.holds(SESSION)).toBe(true)

      yield* fileSystem.remove(`${root}/sessions`, { recursive: true })
      yield* Queue.offer(events, Option.some('sessions'))

      expect(yield* awaitMove(files)).toBe(true)
      expect(yield* files.holds(SESSION)).toBe(false)
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
