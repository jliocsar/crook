import * as Arr from 'effect/Array'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as Equal from 'effect/Equal'
import * as FileSystem from 'effect/FileSystem'
import { pipe } from 'effect/Function'
import * as HashMap from 'effect/HashMap'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as Queue from 'effect/Queue'
import * as Ref from 'effect/Ref'
import * as Schema from 'effect/Schema'
import * as Stream from 'effect/Stream'

import { keepWatching } from '@crook/agent/KeepWatching'
import { flatMapSome } from '@crook/agent/OptionEffect'
import { claudeRoots } from '@crook/claude/ClaudeRoots'
import { FileWatch } from '@crook/claude/FileWatch'
import { ClaudeSessionId } from '@crook/domain/Ids'

interface SessionRecord {
  readonly session: ClaudeSessionId
  readonly waiting: boolean
}

type SessionsByFile = HashMap.HashMap<string, SessionRecord>

const SESSIONS_FOLDER = 'sessions'
const SESSION_FILE_EXTENSION = '.json'
const WAITING_STATUS = 'waiting'
const STAT_COMM_TERMINATOR = ') '
const STAT_START_TIME_INDEX = 19

export const PROC_ROOT = '/proc'

export class ClaudeSessionFileUnreadable extends Schema.TaggedError<ClaudeSessionFileUnreadable>()(
  'ClaudeSessionFileUnreadable',
  { path: Schema.String, cause: Schema.Defect() },
) {
  override get message(): string {
    return `Could not read ${this.path} while looking up a Claude session. Check that crook runs as the same user as Claude, and that the file still has the shape crook expects.`
  }
}

export const SessionFile = Schema.fromJsonString(
  Schema.Struct({
    pid: Schema.Int,
    sessionId: ClaudeSessionId,
    procStart: Schema.String,
    status: Schema.optionalKey(Schema.String),
  }),
)
type SessionFile = typeof SessionFile.Type

export const startTime = (stat: string) =>
  Arr.get(
    stat.slice(stat.lastIndexOf(STAT_COMM_TERMINATOR) + STAT_COMM_TERMINATOR.length).split(' '),
    STAT_START_TIME_INDEX,
  )

const noteRecord =
  (file: string, record: Option.Option<SessionRecord>) =>
  (known: SessionsByFile): readonly [boolean, SessionsByFile] => [
    !Equal.equals(HashMap.get(known, file), record),
    Option.match(record, {
      onNone: () => HashMap.remove(known, file),
      onSome: (named) => HashMap.set(known, file, named),
    }),
  ]

const make = (roots: readonly string[], procRoot: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const watch = yield* FileWatch
    const sessions = yield* Ref.make<SessionsByFile>(HashMap.empty())
    const moved = yield* Queue.sliding<void>(1)

    const contentsOf = (file: string) =>
      fileSystem.readFileString(file).pipe(
        Effect.flatMap(Schema.decodeEffect(SessionFile)),
        Effect.asSome,
        Effect.catchReason('PlatformError', 'NotFound', () =>
          Effect.succeed(Option.none<SessionFile>()),
        ),
        Effect.mapError((cause) => new ClaudeSessionFileUnreadable({ path: file, cause })),
      )

    const readSessionFile = (file: string) =>
      contentsOf(file).pipe(
        Effect.map(
          Option.map((contents): SessionRecord => ({
            session: contents.sessionId,
            waiting: contents.status === WAITING_STATUS,
          })),
        ),
        Effect.flatMap((record) => Ref.modify(sessions, noteRecord(file, record))),
        Effect.catchTag('ClaudeSessionFileUnreadable', (error) =>
          Effect.as(Effect.logDebug(error.message), false),
        ),
      )

    const forgetAllBut =
      (folder: string, files: readonly string[]) =>
      (known: SessionsByFile): readonly [boolean, SessionsByFile] => {
        const gone = pipe(
          Arr.fromIterable(HashMap.keys(known)),
          Arr.filter((file) => path.dirname(file) === folder && !files.includes(file)),
        )

        return [gone.length > 0, HashMap.removeMany(known, gone)]
      }

    const sessionFilesIn = (folder: string) =>
      fileSystem.readDirectory(folder).pipe(
        Effect.catchReason('PlatformError', 'NotFound', () =>
          Effect.succeed<readonly string[]>([]),
        ),
        Effect.map(Arr.filter((name) => name.endsWith(SESSION_FILE_EXTENSION))),
        Effect.map(Arr.map((name) => path.join(folder, name))),
      )

    const readFolder = (folder: string) =>
      sessionFilesIn(folder).pipe(
        Effect.flatMap((files) =>
          Effect.zipWith(
            Ref.modify(sessions, forgetAllBut(folder, files)),
            Effect.forEach(files, readSessionFile, { concurrency: 'unbounded' }),
            (forgot, read) => forgot || Arr.some(read, (movedHere) => movedHere),
          ),
        ),
      )

    const readWhatChanged = (folder: string) =>
      Option.match({
        onNone: () => readFolder(folder),
        onSome: (name: string) =>
          Match.value(name).pipe(
            Match.when(SESSIONS_FOLDER, () => readFolder(folder)),
            Match.when(
              (found) => found.endsWith(SESSION_FILE_EXTENSION),
              (found) => readSessionFile(path.join(folder, found)),
            ),
            Match.orElse(() => Effect.succeed(false)),
          ),
      })

    const followFolder = (root: string) => {
      const folder = path.join(root, SESSIONS_FOLDER)

      return watch.watchWhenPresent(folder).pipe(
        Stream.takeUntil(Option.contains(SESSIONS_FOLDER)),
        Stream.mapEffect(readWhatChanged(folder)),
        Stream.filter((movedHere) => movedHere),
        Stream.runForEach(() => Queue.offer(moved, undefined)),
        keepWatching(folder),
      )
    }

    const isRunning = ({ pid, procStart }: SessionFile) => {
      const statFile = `${procRoot}/${pid}/stat`

      return fileSystem.readFileString(statFile).pipe(
        Effect.map((stat) => Option.contains(startTime(stat), procStart)),
        Effect.catchReason('PlatformError', 'NotFound', () => Effect.succeed(false)),
        Effect.mapError((cause) => new ClaudeSessionFileUnreadable({ path: statFile, cause })),
      )
    }

    const waitingIn = (session: ClaudeSessionId) => (file: string) =>
      contentsOf(file).pipe(
        Effect.map(
          Option.filter(
            (contents) => contents.sessionId === session && contents.status !== undefined,
          ),
        ),
        flatMapSome((contents: SessionFile) =>
          Effect.map(isRunning(contents), (running) =>
            Option.some(running && contents.status === WAITING_STATUS),
          ),
        ),
        Effect.catchTag('ClaudeSessionFileUnreadable', (error) =>
          Effect.as(Effect.logDebug(error.message), Option.none<boolean>()),
        ),
      )

    const waiting = Effect.fn('ClaudeSessionFiles.waiting')(function* (session: ClaudeSessionId) {
      const files = pipe(
        Arr.fromIterable(yield* Ref.get(sessions)),
        Arr.filter(([, record]) => record.session === session),
        Arr.map(([file]) => file),
      )
      const readings = yield* Effect.forEach(files, waitingIn(session), {
        concurrency: 'unbounded',
      })

      return pipe(
        Arr.getSomes(readings),
        Option.liftPredicate(Arr.isReadonlyArrayNonEmpty),
        Option.map(Arr.some((waits) => waits)),
      )
    })

    yield* Effect.forEach(roots, (root) => Effect.forkScoped(followFolder(root)), {
      discard: true,
    })

    return ClaudeSessionFiles.of({
      changes: Stream.fromQueue(moved),
      holds: (session) =>
        Effect.map(
          Ref.get(sessions),
          HashMap.some((held) => held.session === session),
        ),
      waiting,
    })
  })

export class ClaudeSessionFiles extends Context.Service<
  ClaudeSessionFiles,
  {
    readonly changes: Stream.Stream<void>
    readonly holds: (session: ClaudeSessionId) => Effect.Effect<boolean>
    readonly waiting: (session: ClaudeSessionId) => Effect.Effect<Option.Option<boolean>>
  }
>()('@crook/agent/ClaudeSessionFiles') {
  static readonly layerAt = (roots: readonly string[], procRoot: string = PROC_ROOT) =>
    Layer.effect(this, make(roots, procRoot))

  static readonly layer = Layer.unwrap(Effect.map(claudeRoots, (roots) => this.layerAt(roots)))

  static readonly layerTest = (
    held: readonly ClaudeSessionId[] = [],
    changes: Stream.Stream<void> = Stream.never,
    waiting: Effect.Effect<Option.Option<boolean>> = Effect.succeedNone,
  ) =>
    Layer.succeed(
      this,
      ClaudeSessionFiles.of({
        changes,
        holds: (session) => Effect.succeed(held.includes(session)),
        waiting: () => waiting,
      }),
    )
}
