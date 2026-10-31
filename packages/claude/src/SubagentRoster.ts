import * as Arr from 'effect/Array'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import { pipe } from 'effect/Function'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Order from 'effect/Order'
import * as Path from 'effect/Path'
import type { PlatformError } from 'effect/PlatformError'
import * as Schema from 'effect/Schema'
import * as Stream from 'effect/Stream'

import { FileWatch, readyOr } from '@crook/claude/FileWatch'
import {
  NO_TASK_NOTICES,
  type TaskNotices,
  settledRoster,
  taskNoticeLines,
  withTaskNotices,
} from '@crook/claude/TaskNotices'
import {
  SUBAGENT_FILE_PREFIX,
  type TranscriptFile,
  subagentsDirectoryOf,
} from '@crook/claude/TranscriptLocator'
import { type TailError, type TailEvent, TranscriptTail } from '@crook/claude/TranscriptTail'
import { SubagentId } from '@crook/domain/Ids'
import { Subagent, type SubagentStatus } from '@crook/domain/Subagent'
import { TRANSCRIPT_START } from '@crook/domain/Transcript'

interface NoticeScan {
  readonly notices: TaskNotices
  readonly caughtUp: boolean
}

const META_SUFFIX = '.meta.json'
const BACKGROUND_SHAPE = 'background'

export class SubagentsUnreadable extends Schema.TaggedError<SubagentsUnreadable>()(
  'SubagentsUnreadable',
  { path: Schema.String, cause: Schema.Defect() },
) {
  override get message(): string {
    return `Could not read the subagents of a Claude session in ${this.path}. Check that crook runs as the same user as Claude.`
  }
}

const SubagentMeta = Schema.fromJsonString(
  Schema.Struct({
    agentType: Schema.String,
    description: Schema.String,
    model: Schema.optionalKey(Schema.String),
    toolUseId: Schema.optionalKey(Schema.String),
    parentAgentId: Schema.optionalKey(SubagentId),
    spawnDepth: Schema.Int,
    requestShape: Schema.optionalKey(Schema.String),
    finished: Schema.optionalKey(Schema.Boolean),
    stoppedByUser: Schema.optionalKey(Schema.Boolean),
  }),
)

const NO_NOTICE_SCAN: NoticeScan = { notices: NO_TASK_NOTICES, caughtUp: false }
const BY_ID = Order.mapInput(Order.String, (subagent: Subagent) => subagent.id)

const decodeMeta = Schema.decodeUnknownOption(SubagentMeta)

const statusOfMeta = (meta: typeof SubagentMeta.Type): SubagentStatus => {
  if (meta.stoppedByUser === true) {
    return 'stopped'
  }

  return meta.finished === true ? 'completed' : 'running'
}

const decodeSubagentId = Schema.decodeUnknownOption(SubagentId)

const isSameRoster = Schema.toEquivalence(Schema.Array(Subagent))

const subagentIdOf = (name: string) =>
  pipe(
    Option.liftPredicate(
      name,
      (file) => file.startsWith(SUBAGENT_FILE_PREFIX) && file.endsWith(META_SUFFIX),
    ),
    Option.flatMap((file) =>
      decodeSubagentId(file.slice(SUBAGENT_FILE_PREFIX.length, -META_SUFFIX.length)),
    ),
  )

export const subagentFromMeta = (id: SubagentId, content: string) =>
  Option.map(
    decodeMeta(content),
    (meta) =>
      new Subagent({
        id,
        agentType: meta.agentType,
        description: meta.description,
        model: Option.fromUndefinedOr(meta.model),
        toolUseId: Option.fromUndefinedOr(meta.toolUseId),
        parent: Option.fromUndefinedOr(meta.parentAgentId),
        spawnDepth: meta.spawnDepth,
        background: meta.requestShape === BACKGROUND_SHAPE,
        status: statusOfMeta(meta),
      }),
  )

const scanAfter = (scan: NoticeScan, event: TailEvent): NoticeScan =>
  Match.value(event).pipe(
    Match.tagsExhaustive({
      TranscriptChunk: (chunk) => ({
        notices: withTaskNotices(scan.notices, chunk.messages),
        caughtUp: scan.caughtUp,
      }),
      TranscriptCaughtUp: () => ({ notices: scan.notices, caughtUp: true }),
    }),
  )

const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const fileWatch = yield* FileWatch
  const tail = yield* TranscriptTail

  const readRoster = (directory: string) => {
    const unreadable = (cause: PlatformError) => new SubagentsUnreadable({ path: directory, cause })

    const readMeta = (id: SubagentId) => {
      const metaPath = path.join(directory, `${SUBAGENT_FILE_PREFIX}${id}${META_SUFFIX}`)

      return fileSystem.readFileString(metaPath).pipe(
        Effect.map((content) => subagentFromMeta(id, content)),
        Effect.tap((subagent) =>
          Option.isNone(subagent)
            ? Effect.logWarning(
                `Skipped the subagent meta ${metaPath}: it does not have the shape crook reads.`,
              )
            : Effect.void,
        ),
        Effect.catchReason('PlatformError', 'NotFound', () =>
          Effect.succeed(Option.none<Subagent>()),
        ),
        Effect.mapError(unreadable),
      )
    }

    return fileSystem.readDirectory(directory).pipe(
      Effect.catchReason('PlatformError', 'NotFound', () => Effect.succeed(Arr.empty<string>())),
      Effect.mapError(unreadable),
      Effect.map((names) => pipe(names, Arr.map(subagentIdOf), Arr.getSomes)),
      Effect.flatMap((ids) => Effect.forEach(ids, readMeta, { concurrency: 'unbounded' })),
      Effect.map(Arr.getSomes),
      Effect.map(Arr.sort(BY_ID)),
    )
  }

  const watchMetas = (file: TranscriptFile) => {
    const directory = subagentsDirectoryOf(path, file)
    const unreadable = (cause: PlatformError) => new SubagentsUnreadable({ path: directory, cause })

    return fileWatch.watchWhenPresent(directory).pipe(
      Stream.mapError(unreadable),
      Stream.filter(readyOr((name) => name.endsWith(META_SUFFIX))),
      Stream.buffer({ capacity: 1, strategy: 'sliding' }),
      Stream.mapEffect(() => readRoster(directory)),
    )
  }

  const watchNotices = (file: TranscriptFile) =>
    tail.followWith(file, TRANSCRIPT_START, taskNoticeLines).pipe(
      Stream.scan(() => NO_NOTICE_SCAN, scanAfter),
      Stream.filter((scan) => scan.caughtUp),
      Stream.map((scan) => scan.notices),
      Stream.changes,
    )

  const watch = (file: TranscriptFile) =>
    Stream.zipLatest(watchMetas(file), watchNotices(file)).pipe(
      Stream.map(([roster, notices]) => settledRoster(roster, notices)),
      Stream.changesWith(isSameRoster),
    )

  const read = Effect.fn('SubagentRoster.read')(function* (file: TranscriptFile) {
    const [roster, notices] = yield* Effect.all(
      [
        readRoster(subagentsDirectoryOf(path, file)),
        tail.drainWith(file, TRANSCRIPT_START, taskNoticeLines).pipe(
          Stream.runFold(
            () => NO_TASK_NOTICES,
            (known, chunk) => withTaskNotices(known, chunk.messages),
          ),
        ),
      ],
      { concurrency: 'unbounded' },
    )

    return settledRoster(roster, notices)
  })

  const readMetas = (file: TranscriptFile) => readRoster(subagentsDirectoryOf(path, file))

  return SubagentRoster.of({ watch, read, readMetas })
})

export class SubagentRoster extends Context.Service<
  SubagentRoster,
  {
    readonly watch: (
      file: TranscriptFile,
    ) => Stream.Stream<readonly Subagent[], SubagentsUnreadable | TailError>
    readonly read: (
      file: TranscriptFile,
    ) => Effect.Effect<readonly Subagent[], SubagentsUnreadable | TailError>
    readonly readMetas: (
      file: TranscriptFile,
    ) => Effect.Effect<readonly Subagent[], SubagentsUnreadable>
  }
>()('@crook/claude/SubagentRoster') {
  static readonly layer = Layer.effect(this, make)
}
