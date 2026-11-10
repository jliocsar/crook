import * as Arr from 'effect/Array'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import { pipe } from 'effect/Function'
import * as HashSet from 'effect/HashSet'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'

import { ClaudeSessionFiles, PROC_ROOT } from '@crook/agent/ClaudeSessionFiles'
import { taskIdOfOutput } from '@crook/claude/BackgroundTasks'
import type { ClaudeSessionId } from '@crook/domain/Ids'

export type OpenTasks = Option.Option<HashSet.HashSet<string>>

const STANDARD_OUTPUT = '1'

const childPids = (children: string): readonly string[] =>
  Arr.filter(children.trim().split(' '), (pid) => pid.length > 0)

const make = (procRoot: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem
    const sessionFiles = yield* ClaudeSessionFiles

    const readText = (target: string) => fileSystem.readFileString(target).pipe(Effect.option)

    const childrenOf = Effect.fn('TaskLiveness.childrenOf')(function* (pid: number) {
      const threads = yield* fileSystem
        .readDirectory(`${procRoot}/${pid}/task`)
        .pipe(Effect.orElseSucceed(() => Arr.empty<string>()))
      const children = yield* Effect.forEach(
        threads,
        (thread) => readText(`${procRoot}/${pid}/task/${thread}/children`),
        { concurrency: 'unbounded' },
      )

      return pipe(
        Arr.getSomes(children),
        Option.liftPredicate(Arr.isReadonlyArrayNonEmpty),
        Option.map((readable) => pipe(readable, Arr.flatMap(childPids), Arr.dedupe)),
      )
    })

    const outputsIn = Effect.fn('TaskLiveness.outputsIn')(function* (children: readonly string[]) {
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

    const openTasks = Effect.fn('TaskLiveness.openTasks')(function* (session: ClaudeSessionId) {
      return yield* Option.match(yield* sessionFiles.runningPid(session), {
        onNone: () => Effect.succeedNone,
        onSome: (pid) =>
          Effect.flatMap(
            childrenOf(pid),
            Option.match({
              onNone: () => Effect.succeedNone,
              onSome: (children) => Effect.asSome(outputsIn(children)),
            }),
          ),
      })
    })

    return TaskLiveness.of({ openTasks })
  })

export class TaskLiveness extends Context.Service<
  TaskLiveness,
  { readonly openTasks: (session: ClaudeSessionId) => Effect.Effect<OpenTasks> }
>()('@crook/agent/TaskLiveness') {
  static readonly layerAt = (procRoot: string) => Layer.effect(this, make(procRoot))

  static readonly layer = this.layerAt(PROC_ROOT)

  static readonly layerTest = (outputs: (session: ClaudeSessionId) => OpenTasks) =>
    Layer.succeed(
      this,
      TaskLiveness.of({ openTasks: (session) => Effect.succeed(outputs(session)) }),
    )
}
