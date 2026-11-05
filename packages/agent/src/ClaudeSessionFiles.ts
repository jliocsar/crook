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
import { claudeRoots } from '@crook/claude/ClaudeRoots'
import { FileWatch } from '@crook/claude/FileWatch'
import { ClaudeSessionId } from '@crook/domain/Ids'

type SessionsByFile = HashMap.HashMap<string, ClaudeSessionId>

const SESSIONS_FOLDER = 'sessions'
const SESSION_FILE_EXTENSION = '.json'

export class ClaudeSessionFileUnreadable extends Schema.TaggedError<ClaudeSessionFileUnreadable>()(
  'ClaudeSessionFileUnreadable',
  { path: Schema.String, cause: Schema.Defect() },
) {
  override get message(): string {
    return `Could not read ${this.path} while looking up a Claude session. Check that crook runs as the same user as Claude, and that the file still has the shape crook expects.`
  }
}

export const SessionFile = Schema.fromJsonString(
  Schema.Struct({ pid: Schema.Int, sessionId: ClaudeSessionId, procStart: Schema.String }),
)

const noteSession =
  (file: string, session: Option.Option<ClaudeSessionId>) =>
  (known: SessionsByFile): readonly [boolean, SessionsByFile] => [
    !Equal.equals(HashMap.get(known, file), session),
    Option.match(session, {
      onNone: () => HashMap.remove(known, file),
      onSome: (named) => HashMap.set(known, file, named),
    }),
  ]

const make = (roots: readonly string[]) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const watch = yield* FileWatch
    const sessions = yield* Ref.make<SessionsByFile>(HashMap.empty())
    const moved = yield* Queue.sliding<void>(1)

    const sessionIn = (file: string) =>
      fileSystem.readFileString(file).pipe(
        Effect.flatMap(Schema.decodeEffect(SessionFile)),
        Effect.map((contents) => Option.some(contents.sessionId)),
        Effect.catchReason('PlatformError', 'NotFound', () => Effect.succeedNone),
        Effect.mapError((cause) => new ClaudeSessionFileUnreadable({ path: file, cause })),
      )

    const readSessionFile = (file: string) =>
      sessionIn(file).pipe(
        Effect.flatMap((session) => Ref.modify(sessions, noteSession(file, session))),
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

    yield* Effect.forEach(roots, (root) => Effect.forkScoped(followFolder(root)), {
      discard: true,
    })

    return ClaudeSessionFiles.of({
      changes: Stream.fromQueue(moved),
      holds: (session) =>
        Effect.map(
          Ref.get(sessions),
          HashMap.some((held) => held === session),
        ),
    })
  })

export class ClaudeSessionFiles extends Context.Service<
  ClaudeSessionFiles,
  {
    readonly changes: Stream.Stream<void>
    readonly holds: (session: ClaudeSessionId) => Effect.Effect<boolean>
  }
>()('@crook/agent/ClaudeSessionFiles') {
  static readonly layerAt = (roots: readonly string[]) => Layer.effect(this, make(roots))

  static readonly layer = Layer.unwrap(Effect.map(claudeRoots, (roots) => this.layerAt(roots)))

  static readonly layerTest = (
    held: readonly ClaudeSessionId[] = [],
    changes: Stream.Stream<void> = Stream.never,
  ) =>
    Layer.succeed(
      this,
      ClaudeSessionFiles.of({
        changes,
        holds: (session) => Effect.succeed(held.includes(session)),
      }),
    )
}
