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

import { TaskLiveness } from '@crook/agent/TaskLiveness'
import { TranscriptFile } from '@crook/claude/TranscriptLocator'
import { ClaudeSessionId } from '@crook/domain/Ids'

const CLAUDE_STAT =
  '2224797 (claude) S 1815179 2224797 1815179 34828 2224797 4194304 1549769 10025154 33084 1757 63039 6528 14996 4773 20 0 31 0 248837515 5818683392 99488 18446744073709551615 27164160 97022672 140736926585248 0 0 0 0 4096 2072145151 0 0 0 17 0 0 0 0 0 0 97026768 270004224 755728384 140736926593345 140736926596185 140736926596185 140736926605241 0'

const CLAUDE_PROC_START = '248837515'
const CLAUDE_PID = 2224797
const SHELL_PID = 2230001
const SERVER_PID = 2230002
const SESSION = ClaudeSessionId.make('270d2fc3-129e-4a0d-aef3-78f495af98c9')

const PidFile = Schema.fromJsonString(
  Schema.Struct({ pid: Schema.Int, sessionId: Schema.String, procStart: Schema.String }),
)

const liveness = Effect.fn('liveness')(function* (procStart: string) {
  const fileSystem = yield* FileSystem.FileSystem
  const root = yield* fileSystem.makeTempDirectoryScoped()
  const proc = `${root}/proc`
  const claudeRoot = `${root}/claude`
  const tasks = `${root}/claude-tmp/project/${SESSION}/tasks`

  yield* fileSystem.makeDirectory(`${proc}/${CLAUDE_PID}/task/${CLAUDE_PID}`, { recursive: true })
  yield* fileSystem.makeDirectory(`${proc}/${SHELL_PID}/fd`, { recursive: true })
  yield* fileSystem.makeDirectory(`${proc}/${SERVER_PID}/fd`, { recursive: true })
  yield* fileSystem.makeDirectory(`${claudeRoot}/sessions`, { recursive: true })
  yield* fileSystem.makeDirectory(`${claudeRoot}/projects/-home-crook`, { recursive: true })
  yield* fileSystem.makeDirectory(tasks, { recursive: true })
  yield* fileSystem.writeFileString(`${proc}/${CLAUDE_PID}/stat`, CLAUDE_STAT)
  yield* fileSystem.writeFileString(
    `${proc}/${CLAUDE_PID}/task/${CLAUDE_PID}/children`,
    `${SHELL_PID} ${SERVER_PID} `,
  )
  yield* fileSystem.symlink(`${tasks}/bdev.output`, `${proc}/${SHELL_PID}/fd/1`)
  yield* fileSystem.symlink('/dev/null', `${proc}/${SERVER_PID}/fd/1`)
  yield* fileSystem.writeFileString(
    `${claudeRoot}/sessions/${CLAUDE_PID}.json`,
    yield* Schema.encodeEffect(PidFile)({ pid: CLAUDE_PID, sessionId: SESSION, procStart }),
  )

  const context = yield* Layer.build(TaskLiveness.layerAt(proc))
  const file = new TranscriptFile({
    session: SESSION,
    path: `${claudeRoot}/projects/-home-crook/${SESSION}.jsonl`,
  })

  return yield* Context.get(context, TaskLiveness).openTasks(file)
})

layer(Layer.mergeAll(BunFileSystem.layer, Path.layer), { excludeTestServices: true })(
  'TaskLiveness',
  (live) => {
    live.effect('names the tasks whose output file a child of the Claude still writes', () =>
      Effect.gen(function* () {
        const open = yield* liveness(CLAUDE_PROC_START)

        expect(Option.map(open, (tasks) => Arr.fromIterable(tasks))).toEqual(Option.some(['bdev']))
      }),
    )

    live.effect('knows nothing once the pid belongs to another process', () =>
      Effect.gen(function* () {
        expect(yield* liveness('1')).toEqual(Option.none())
      }),
    )
  },
)
