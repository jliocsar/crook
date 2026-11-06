import * as BunFileSystem from '@effect/platform-bun/BunFileSystem'
import { expect, layer } from '@effect/vitest'
import * as Arr from 'effect/Array'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as Schema from 'effect/Schema'
import * as Stream from 'effect/Stream'

import { ClaudeSessionFiles, SessionFile, sessionFileOf } from '@crook/agent/ClaudeSessionFiles'
import { TaskLiveness } from '@crook/agent/TaskLiveness'
import { FileWatch } from '@crook/claude/FileWatch'
import { ClaudeSessionId } from '@crook/domain/Ids'

const CLAUDE_STAT =
  '2224797 (claude) S 1815179 2224797 1815179 34828 2224797 4194304 1549769 10025154 33084 1757 63039 6528 14996 4773 20 0 31 0 248837515 5818683392 99488 18446744073709551615 27164160 97022672 140736926585248 0 0 0 0 4096 2072145151 0 0 0 17 0 0 0 0 0 0 97026768 270004224 755728384 140736926593345 140736926596185 140736926596185 140736926605241 0'

const CLAUDE_PROC_START = '248837515'
const CLAUDE_PID = 2224797
const SHELL_PID = 2230001
const SERVER_PID = 2230002
const CLAUDE_CHILDREN = `${SHELL_PID} ${SERVER_PID} `
const SESSION = ClaudeSessionId.make('270d2fc3-129e-4a0d-aef3-78f495af98c9')

const livenessOver = (procRoot: string, runningPid: Option.Option<number>) =>
  Effect.map(
    Layer.build(
      Layer.provide(
        TaskLiveness.layerAt(procRoot),
        ClaudeSessionFiles.layerTest([], Stream.never, Effect.succeedNone, runningPid),
      ),
    ),
    (context) => Context.get(context, TaskLiveness),
  )

const procWithClaude = Effect.fn('procWithClaude')(function* (
  children: Option.Option<string> = Option.some(CLAUDE_CHILDREN),
) {
  const fileSystem = yield* FileSystem.FileSystem
  const root = yield* fileSystem.makeTempDirectoryScoped()
  const proc = `${root}/proc`
  const tasks = `${root}/claude-tmp/project/${SESSION}/tasks`

  yield* fileSystem.makeDirectory(`${proc}/${CLAUDE_PID}/task/${CLAUDE_PID}`, { recursive: true })
  yield* fileSystem.makeDirectory(`${proc}/${SHELL_PID}/fd`, { recursive: true })
  yield* fileSystem.makeDirectory(`${proc}/${SERVER_PID}/fd`, { recursive: true })
  yield* fileSystem.makeDirectory(tasks, { recursive: true })
  yield* Effect.forEach(Option.toArray(children), (listed) =>
    fileSystem.writeFileString(`${proc}/${CLAUDE_PID}/task/${CLAUDE_PID}/children`, listed),
  )
  yield* fileSystem.symlink(`${tasks}/bdev.output`, `${proc}/${SHELL_PID}/fd/1`)
  yield* fileSystem.symlink('/dev/null', `${proc}/${SERVER_PID}/fd/1`)

  return { root, proc }
})

const liveness = Effect.fn('liveness')(function* (
  children: Option.Option<string> = Option.some(CLAUDE_CHILDREN),
  runningPid: Option.Option<number> = Option.some(CLAUDE_PID),
) {
  const { proc } = yield* procWithClaude(children)
  const tasksOf = yield* livenessOver(proc, runningPid)

  return yield* tasksOf.openTasks(SESSION)
})

layer(BunFileSystem.layer, { excludeTestServices: true })('TaskLiveness', (live) => {
  live.effect('names the tasks whose output file a child of the Claude still writes', () =>
    Effect.gen(function* () {
      const open = yield* liveness()

      expect(Option.map(open, (tasks) => Arr.fromIterable(tasks))).toEqual(Option.some(['bdev']))
    }),
  )

  live.effect('follows a pid file on disk through to the tasks its Claude still writes', () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const { root, proc } = yield* procWithClaude()
      const claudeRoot = `${root}/claude`

      yield* fileSystem.writeFileString(`${proc}/${CLAUDE_PID}/stat`, CLAUDE_STAT)
      yield* fileSystem.makeDirectory(`${claudeRoot}/sessions`, { recursive: true })
      yield* fileSystem.writeFileString(
        sessionFileOf(claudeRoot, CLAUDE_PID),
        yield* Schema.encodeEffect(SessionFile)({
          pid: CLAUDE_PID,
          sessionId: SESSION,
          procStart: CLAUDE_PROC_START,
        }),
      )

      const context = yield* Layer.build(
        Layer.provideMerge(
          TaskLiveness.layerAt(proc),
          ClaudeSessionFiles.layerAt([claudeRoot], proc),
        ).pipe(Layer.provide(Layer.provideMerge(FileWatch.layer, Path.layer))),
      )

      yield* Stream.runHead(Context.get(context, ClaudeSessionFiles).changes)

      const open = yield* Context.get(context, TaskLiveness).openTasks(SESSION)

      expect(Option.map(open, (tasks) => Arr.fromIterable(tasks))).toEqual(Option.some(['bdev']))
    }),
  )

  live.effect('knows nothing when no running Claude holds the session', () =>
    Effect.gen(function* () {
      expect(yield* liveness(undefined, Option.none())).toEqual(Option.none())
    }),
  )

  live.effect('knows nothing when the kernel does not list a process children', () =>
    Effect.gen(function* () {
      expect(yield* liveness(Option.none())).toEqual(Option.none())
    }),
  )

  live.effect('knows nothing on a system without /proc', () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const root = yield* fileSystem.makeTempDirectoryScoped()
      const tasksOf = yield* livenessOver(`${root}/proc`, Option.some(CLAUDE_PID))

      expect(yield* tasksOf.openTasks(SESSION)).toEqual(Option.none())
    }),
  )
})
