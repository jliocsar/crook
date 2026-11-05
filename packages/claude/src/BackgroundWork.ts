import * as Arr from 'effect/Array'
import * as Context from 'effect/Context'
import * as DateTime from 'effect/DateTime'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import { pipe } from 'effect/Function'
import * as HashMap from 'effect/HashMap'
import * as HashSet from 'effect/HashSet'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Order from 'effect/Order'
import * as Path from 'effect/Path'
import * as Schema from 'effect/Schema'
import * as Stream from 'effect/Stream'
import * as Struct from 'effect/Struct'

import {
  type BackgroundLedger,
  backgroundTasks,
  outputFileOf,
  sameTasks,
} from '@crook/claude/BackgroundTasks'
import { FileWatch, readyOr } from '@crook/claude/FileWatch'
import { SessionScans } from '@crook/claude/SessionScans'
import { SubagentRoster, SubagentsUnreadable } from '@crook/claude/SubagentRoster'
import { withoutAnsi } from '@crook/claude/TranscriptParser'
import {
  SUBAGENT_FILE_PREFIX,
  type TranscriptFile,
  subagentsDirectoryOf,
} from '@crook/claude/TranscriptLocator'
import { NEWLINE, TAIL_READ_SIZE, type TailError, messagesIn } from '@crook/claude/TranscriptTail'
import { type BackgroundTask, ShellTask, SubagentActivity } from '@crook/domain/Background'
import { SubagentId } from '@crook/domain/Ids'
import type { AssistantMessage, TranscriptMessage } from '@crook/domain/TranscriptMessage'
import { firstLine, toolSubject } from '@crook/domain/ToolSubject'

export interface BackgroundSnapshot {
  readonly tasks: readonly BackgroundTask[]
  readonly activity: readonly SubagentActivity[]
}

interface FileTail {
  readonly bytes: Uint8Array
  readonly fromStart: boolean
  readonly modifiedAt: Option.Option<DateTime.Utc>
  readonly size: number
}

interface OutputTail {
  readonly lines: readonly string[]
  readonly at: Option.Option<DateTime.Utc>
  readonly size: number
}

export type BackgroundWatchError = TailError | SubagentsUnreadable | BackgroundOutputUnreadable

type OutputTails = HashMap.HashMap<string, OutputTail>

type ShellOutputs = HashMap.HashMap<string, string>

type Activities = HashMap.HashMap<SubagentId, SubagentActivity>

export class BackgroundOutputUnreadable extends Schema.TaggedError<BackgroundOutputUnreadable>()(
  'BackgroundOutputUnreadable',
  { path: Schema.String, cause: Schema.Defect() },
) {
  override get message(): string {
    return `Could not watch ${this.path}, where Claude writes the output of background commands. Check that crook runs as the same user as Claude.`
  }
}

const OUTPUT_TAIL_LINES = 3
const TRANSCRIPT_EXTENSION = '.jsonl'
const CARRIAGE_RETURN = '\r'
const TRAILING_CARRIAGE_RETURNS = /\r+$/u
const LINE_BREAK = '\n'
const NO_OUTPUTS: OutputTails = HashMap.empty()
const NO_ACTIVITY: Activities = HashMap.empty()
const BY_SUBAGENT = Order.mapInput(Order.String, (activity: SubagentActivity) => activity.subagent)

const decoder = new TextDecoder()

const isSameActivity = Schema.toEquivalence(Schema.Array(SubagentActivity))

const decodeSubagentId = Schema.decodeUnknownOption(SubagentId)

export const sameSnapshot = (left: BackgroundSnapshot, right: BackgroundSnapshot): boolean =>
  sameTasks(left.tasks, right.tasks) && isSameActivity(left.activity, right.activity)

const shellOutputsOf = (ledger: BackgroundLedger): ShellOutputs =>
  pipe(
    backgroundTasks(ledger),
    Arr.filter(Schema.is(ShellTask)),
    Arr.flatMap((task) =>
      Option.toArray(
        Option.map(outputFileOf(ledger, task.taskId), (outputFile): readonly [string, string] => [
          task.taskId,
          outputFile,
        ]),
      ),
    ),
    HashMap.fromIterable,
  )

const sameMoment = Option.makeEquivalence(DateTime.Equivalence)

const isUnchanged = (known: Option.Option<OutputTail>, info: FileSystem.File.Info) =>
  Option.exists(
    known,
    (output) =>
      output.size === Number(info.size) &&
      sameMoment(output.at, Option.map(info.mtime, DateTime.fromDateUnsafe)),
  )

const completeLinesOf = (tail: FileTail): Uint8Array => {
  const start = tail.fromStart ? 0 : tail.bytes.indexOf(NEWLINE) + 1
  const end = tail.bytes.lastIndexOf(NEWLINE) + 1

  return end > start ? tail.bytes.subarray(start, end) : new Uint8Array(0)
}

const lastLineOf = (line: string): string => {
  const ended = line.replace(TRAILING_CARRIAGE_RETURNS, '')

  return withoutAnsi(ended.slice(ended.lastIndexOf(CARRIAGE_RETURN) + 1)).trimEnd()
}

export const outputLines = (tail: FileTail): readonly string[] =>
  pipe(
    decoder.decode(
      tail.fromStart ? tail.bytes : tail.bytes.subarray(tail.bytes.indexOf(NEWLINE) + 1),
    ),
    (text) => text.split(LINE_BREAK),
    Arr.map(lastLineOf),
    Arr.filter((line) => line.trim().length > 0),
    Arr.takeRight(OUTPUT_TAIL_LINES),
  )

const activityOfMessage =
  (subagent: SubagentId) =>
  (message: AssistantMessage): Option.Option<SubagentActivity> =>
    Arr.findLast(message.blocks, (block) =>
      Match.value(block).pipe(
        Match.tag('ToolUse', (use) =>
          Option.some(
            new SubagentActivity({
              subagent,
              tool: Option.some(use.name),
              subject: toolSubject(use.name, use.input),
              text: Option.none(),
              at: message.timestamp,
            }),
          ),
        ),
        Match.tag('Text', (text) =>
          Option.map(
            Option.liftPredicate(firstLine(text.text), (line) => line.length > 0),
            (line) =>
              new SubagentActivity({
                subagent,
                tool: Option.none(),
                subject: Option.none(),
                text: Option.some(line),
                at: message.timestamp,
              }),
          ),
        ),
        Match.orElse(() => Option.none<SubagentActivity>()),
      ),
    )

const activityIn = (
  subagent: SubagentId,
  messages: readonly TranscriptMessage[],
): Option.Option<SubagentActivity> =>
  Arr.findLast(messages, (message) =>
    Match.value(message).pipe(
      Match.tag('Assistant', activityOfMessage(subagent)),
      Match.orElse(() => Option.none<SubagentActivity>()),
    ),
  )

const subagentOfFile = (name: string): Option.Option<SubagentId> =>
  pipe(
    Option.liftPredicate(
      name,
      (file) => file.startsWith(SUBAGENT_FILE_PREFIX) && file.endsWith(TRANSCRIPT_EXTENSION),
    ),
    Option.flatMap((file) =>
      decodeSubagentId(file.slice(SUBAGENT_FILE_PREFIX.length, -TRANSCRIPT_EXTENSION.length)),
    ),
  )

const withOutputs = (tasks: readonly BackgroundTask[], outputs: OutputTails) =>
  Arr.map(tasks, (task) =>
    Match.value(task).pipe(
      Match.tag('ShellTask', (shell) =>
        Option.match(HashMap.get(outputs, shell.taskId), {
          onNone: (): BackgroundTask => shell,
          onSome: (output): BackgroundTask =>
            new ShellTask(
              Struct.evolve(shell, { output: () => output.lines, lastOutputAt: () => output.at }),
            ),
        }),
      ),
      Match.orElse((): BackgroundTask => task),
    ),
  )

const sortedActivity = (activities: Activities): readonly SubagentActivity[] =>
  Arr.sort(HashMap.toValues(activities), BY_SUBAGENT)

const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const fileWatch = yield* FileWatch
  const scans = yield* SessionScans
  const roster = yield* SubagentRoster

  const openTail = Effect.fn('BackgroundWork.openTail')(function* (target: string) {
    const handle = yield* fileSystem.open(target, { flag: 'r' })
    const info = yield* handle.stat
    const size = Number(info.size)
    const start = Math.max(0, size - TAIL_READ_SIZE)
    const bytes = yield* handle.readAlloc(size - start, { position: BigInt(start) })

    return Option.some<FileTail>({
      bytes: Option.getOrElse(bytes, () => new Uint8Array(0)),
      fromStart: start === 0,
      modifiedAt: Option.map(info.mtime, DateTime.fromDateUnsafe),
      size,
    })
  }, Effect.scoped)

  const readTail = Effect.fn('BackgroundWork.readTail')(function* (target: string) {
    return yield* openTail(target).pipe(
      Effect.catchReason('PlatformError', 'NotFound', () => Effect.succeedNone),
      Effect.mapError((cause) => new BackgroundOutputUnreadable({ path: target, cause })),
    )
  })

  const refreshOutput = Effect.fn('BackgroundWork.refreshOutput')(function* (
    outputFile: string,
    known: Option.Option<OutputTail>,
  ) {
    const info = yield* fileSystem.stat(outputFile)

    if (isUnchanged(known, info)) {
      return known
    }

    return Option.map(yield* openTail(outputFile), (fileTail): OutputTail => ({
      lines: outputLines(fileTail),
      at: fileTail.modifiedAt,
      size: fileTail.size,
    }))
  })

  const outputAfter = Effect.fn('BackgroundWork.outputAfter')(function* (
    outputFile: string,
    known: Option.Option<OutputTail>,
  ) {
    return yield* refreshOutput(outputFile, known).pipe(
      Effect.catchReason('PlatformError', 'NotFound', () => Effect.succeed(known)),
      Effect.mapError((cause) => new BackgroundOutputUnreadable({ path: outputFile, cause })),
    )
  })

  const outputsAfter = (files: ShellOutputs, known: OutputTails) =>
    Effect.map(
      Effect.forEach(
        files,
        ([taskId, outputFile]) =>
          Effect.map(outputAfter(outputFile, HashMap.get(known, taskId)), (output) =>
            Option.map(output, (found): readonly [string, OutputTail] => [taskId, found]),
          ),
        { concurrency: 'unbounded' },
      ),
      (found): OutputTails => HashMap.fromIterable(Arr.getSomes(found)),
    )

  const watchOutputs = (
    files: ShellOutputs,
  ): Stream.Stream<OutputTails, BackgroundOutputUnreadable> => {
    const names = HashSet.fromIterable(
      Arr.map(HashMap.toValues(files), (file) => path.basename(file)),
    )
    const directories = pipe(
      HashMap.toValues(files),
      Arr.map((file) => path.dirname(file)),
      Arr.dedupe,
    )

    return Arr.isReadonlyArrayNonEmpty(directories)
      ? Stream.unwrap(
          Effect.map(outputsAfter(files, NO_OUTPUTS), (current) =>
            Stream.mergeAll(
              Arr.map(directories, (directory) =>
                fileWatch
                  .watchWhenPresent(directory)
                  .pipe(
                    Stream.mapError(
                      (cause) => new BackgroundOutputUnreadable({ path: directory, cause }),
                    ),
                  ),
              ),
              { concurrency: 'unbounded' },
            ).pipe(
              Stream.filter(readyOr((name) => HashSet.has(names, name))),
              Stream.buffer({ capacity: 1, strategy: 'sliding' }),
              Stream.scanEffect(
                () => current,
                (known) => outputsAfter(files, known),
              ),
            ),
          ),
        )
      : Stream.succeed(NO_OUTPUTS)
  }

  const readActivity = (file: TranscriptFile, subagent: SubagentId) =>
    Effect.map(
      readTail(
        path.join(
          subagentsDirectoryOf(path, file),
          `${SUBAGENT_FILE_PREFIX}${subagent}${TRANSCRIPT_EXTENSION}`,
        ),
      ),
      (found) =>
        Option.flatMap(found, (fileTail) =>
          activityIn(subagent, messagesIn(completeLinesOf(fileTail), 0)),
        ),
    )

  const activityAfter = (
    file: TranscriptFile,
    known: Activities,
    subagents: readonly SubagentId[],
  ) =>
    Effect.map(
      Effect.forEach(subagents, (subagent) => readActivity(file, subagent), {
        concurrency: 'unbounded',
      }),
      (found) =>
        pipe(
          Arr.getSomes(found),
          Arr.reduce(known, (activities, activity) =>
            HashMap.set(activities, activity.subagent, activity),
          ),
        ),
    )

  const watchActivity = (file: TranscriptFile) => {
    const directory = subagentsDirectoryOf(path, file)

    return fileWatch.watchWhenPresent(directory).pipe(
      Stream.mapError((cause) => new SubagentsUnreadable({ path: directory, cause })),
      Stream.mapEffect((event) =>
        Option.match(event, {
          onNone: () =>
            Effect.map(roster.readMetas(file), (subagents) =>
              pipe(
                subagents,
                Arr.filter((subagent) => subagent.status === 'running'),
                Arr.map((subagent) => subagent.id),
              ),
            ),
          onSome: (name) => Effect.succeed(Option.toArray(subagentOfFile(name))),
        }),
      ),
      Stream.filter(Arr.isReadonlyArrayNonEmpty),
      Stream.scanEffect(
        () => NO_ACTIVITY,
        (known, subagents) => activityAfter(file, known, subagents),
      ),
      Stream.map(sortedActivity),
    )
  }

  const ledgers = (file: TranscriptFile) =>
    scans.follow(file).pipe(Stream.map((scan) => scan.ledger))

  const watch = (file: TranscriptFile): Stream.Stream<BackgroundSnapshot, BackgroundWatchError> =>
    Stream.unwrap(
      Effect.map(Stream.share(ledgers(file), { capacity: 'unbounded', replay: 1 }), (shared) =>
        Stream.zipLatestAll(
          shared,
          shared.pipe(Stream.map(shellOutputsOf), Stream.changes, Stream.switchMap(watchOutputs)),
          watchActivity(file),
        ).pipe(
          Stream.map(([ledger, outputs, activity]): BackgroundSnapshot => ({
            tasks: withOutputs(backgroundTasks(ledger), outputs),
            activity,
          })),
          Stream.changesWith(sameSnapshot),
        ),
      ),
    )

  return BackgroundWork.of({ watch })
})

export class BackgroundWork extends Context.Service<
  BackgroundWork,
  {
    readonly watch: (
      file: TranscriptFile,
    ) => Stream.Stream<BackgroundSnapshot, BackgroundWatchError>
  }
>()('@crook/claude/BackgroundWork') {
  static readonly layer = Layer.effect(this, make)
}
