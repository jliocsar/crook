import * as Arr from 'effect/Array'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import { pipe } from 'effect/Function'
import * as HashSet from 'effect/HashSet'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as Schema from 'effect/Schema'

import { PROC_ROOT, startTime } from '@crook/agent/ClaudeSessions'
import { taskIdOfOutput } from '@crook/claude/BackgroundTasks'
import type { TranscriptFile } from '@crook/claude/TranscriptLocator'
import type { ClaudeSessionId } from '@crook/domain/Ids'

export type OpenTasks = Option.Option<HashSet.HashSet<string>>

const SESSIONS_DIRECTORY = 'sessions'
const SESSION_FILE_EXTENSION = '.json'
const STANDARD_OUTPUT = '1'

const SessionFile = Schema.fromJsonString(
  Schema.Struct({ pid: Schema.Int, sessionId: Schema.String, procStart: Schema.String }),
)

const decodeSessionFile = Schema.decodeUnknownOption(SessionFile)

const childPids = (children: string): readonly string[] =>
  Arr.filter(children.trim().split(' '), (pid) => pid.length > 0)

const make = (procRoot: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem
    const path = yield* Path.Path

    const readText = (target: string) => fileSystem.readFileString(target).pipe(Effect.option)

    const claudeRootOf = (file: TranscriptFile) =>
      path.dirname(path.dirname(path.dirname(file.path)))

    const claudePid = Effect.fn('TaskLiveness.claudePid')(function* (file: TranscriptFile) {
      const directory = path.join(claudeRootOf(file), SESSIONS_DIRECTORY)
      const names = yield* fileSystem
        .readDirectory(directory)
        .pipe(Effect.orElseSucceed(() => Arr.empty<string>()))
      const sessions = yield* Effect.forEach(
        Arr.filter(names, (name) => name.endsWith(SESSION_FILE_EXTENSION)),
        (name) =>
          Effect.map(readText(path.join(directory, name)), Option.flatMap(decodeSessionFile)),
        { concurrency: 'unbounded' },
      )
      const owner = pipe(
        Arr.getSomes(sessions),
        Arr.findFirst((session) => session.sessionId === file.session),
      )

      return yield* Option.match(owner, {
        onNone: () => Effect.succeedNone,
        onSome: (session) =>
          Effect.map(readText(`${procRoot}/${session.pid}/stat`), (stat) =>
            pipe(
              stat,
              Option.flatMap(startTime),
              Option.filter((started) => started === session.procStart),
              Option.as(session.pid),
            ),
          ),
      })
    })

    const childrenOf = Effect.fn('TaskLiveness.childrenOf')(function* (pid: number) {
      const threads = yield* fileSystem
        .readDirectory(`${procRoot}/${pid}/task`)
        .pipe(Effect.orElseSucceed(() => Arr.empty<string>()))
      const children = yield* Effect.forEach(
        threads,
        (thread) => readText(`${procRoot}/${pid}/task/${thread}/children`),
        { concurrency: 'unbounded' },
      )

      return pipe(Arr.getSomes(children), Arr.flatMap(childPids), Arr.dedupe)
    })

    const outputsOf = Effect.fn('TaskLiveness.outputsOf')(function* (pid: number) {
      const children = yield* childrenOf(pid)
      const targets = yield* Effect.forEach(
        children,
        (child) =>
          fileSystem.readLink(`${procRoot}/${child}/fd/${STANDARD_OUTPUT}`).pipe(Effect.option),
        { concurrency: 'unbounded' },
      )

      return HashSet.fromIterable(
        pipe(
          Arr.getSomes(targets),
          Arr.flatMap((target) => Option.toArray(taskIdOfOutput(target))),
        ),
      )
    })

    const openTasks = Effect.fn('TaskLiveness.openTasks')(function* (file: TranscriptFile) {
      if (!(yield* fileSystem.exists(procRoot).pipe(Effect.orElseSucceed(() => false)))) {
        return Option.none<HashSet.HashSet<string>>()
      }

      return yield* Option.match(yield* claudePid(file), {
        onNone: () => Effect.succeedNone,
        onSome: (pid) => Effect.map(outputsOf(pid), Option.some),
      })
    })

    return TaskLiveness.of({ openTasks })
  })

export class TaskLiveness extends Context.Service<
  TaskLiveness,
  { readonly openTasks: (file: TranscriptFile) => Effect.Effect<OpenTasks> }
>()('@crook/agent/TaskLiveness') {
  static readonly layerAt = (procRoot: string) => Layer.effect(this, make(procRoot))

  static readonly layer = this.layerAt(PROC_ROOT)

  static readonly layerTest = (outputs: (session: ClaudeSessionId) => OpenTasks) =>
    Layer.succeed(
      this,
      TaskLiveness.of({ openTasks: (file) => Effect.succeed(outputs(file.session)) }),
    )
}
