import * as Arr from 'effect/Array'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import { pipe } from 'effect/Function'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import type { PlatformError } from 'effect/PlatformError'
import * as Schema from 'effect/Schema'
import * as Stream from 'effect/Stream'

import { claudeRoots } from '@crook/claude/ClaudeRoots'
import { FileWatch, readyOr } from '@crook/claude/FileWatch'
import { ClaudeSessionId, type SubagentId } from '@crook/domain/Ids'

export type LocateError = TranscriptSessionInvalid | TranscriptDirectoryUnreadable

const PROJECTS_DIRECTORY = 'projects'
const TRANSCRIPT_EXTENSION = '.jsonl'
const SUBAGENTS_DIRECTORY = 'subagents'
const SAFE_SESSION_ID = /^[0-9A-Za-z][0-9A-Za-z-]*$/u

export const SUBAGENT_FILE_PREFIX = 'agent-'

export class TranscriptFile extends Schema.Class<TranscriptFile>('TranscriptFile')({
  session: ClaudeSessionId,
  path: Schema.String,
}) {}

export class TranscriptSessionInvalid extends Schema.TaggedError<TranscriptSessionInvalid>()(
  'TranscriptSessionInvalid',
  { session: ClaudeSessionId },
) {
  override get message(): string {
    return `"${this.session}" is not a Claude session id: crook only looks up ids made of letters, digits and dashes, so it never builds a path from anything else. Pick the session from the pane again.`
  }
}

export class TranscriptDirectoryUnreadable extends Schema.TaggedError<TranscriptDirectoryUnreadable>()(
  'TranscriptDirectoryUnreadable',
  { path: Schema.String, cause: Schema.Defect() },
) {
  override get message(): string {
    return `Could not read ${this.path} while looking for a Claude transcript. Check that crook runs as the same user as Claude and that CROOK_CLAUDE_ROOTS names Claude's config folders.`
  }
}

export const sessionDirectoryOf = (path: Path.Path, file: TranscriptFile) =>
  path.join(path.dirname(file.path), path.basename(file.path, TRANSCRIPT_EXTENSION))

export const subagentsDirectoryOf = (path: Path.Path, file: TranscriptFile) =>
  path.join(sessionDirectoryOf(path, file), SUBAGENTS_DIRECTORY)

export const subagentFileOf = (path: Path.Path, file: TranscriptFile, subagent: SubagentId) =>
  new TranscriptFile({
    session: file.session,
    path: path.join(
      subagentsDirectoryOf(path, file),
      `${SUBAGENT_FILE_PREFIX}${subagent}${TRANSCRIPT_EXTENSION}`,
    ),
  })

const make = (roots: readonly string[]) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const watch = yield* FileWatch

    const unreadable = (directory: string) => (cause: PlatformError) =>
      new TranscriptDirectoryUnreadable({ path: directory, cause })

    const validSession = (session: ClaudeSessionId) =>
      SAFE_SESSION_ID.test(session)
        ? Effect.succeed(session)
        : Effect.fail(new TranscriptSessionInvalid({ session }))

    const projectDirectories = (root: string) => {
      const projects = path.join(root, PROJECTS_DIRECTORY)

      return fileSystem.readDirectory(projects).pipe(
        Effect.map(Arr.map((name) => path.join(projects, name))),
        Effect.catchReason('PlatformError', 'NotFound', () => Effect.succeed(Arr.empty<string>())),
        Effect.mapError(unreadable(projects)),
      )
    }

    const fileIn = (directory: string, session: ClaudeSessionId) => {
      const file = new TranscriptFile({
        session,
        path: path.join(directory, `${session}${TRANSCRIPT_EXTENSION}`),
      })

      return fileSystem.exists(file.path).pipe(
        Effect.map((exists) => (exists ? Option.some(file) : Option.none())),
        Effect.mapError(unreadable(file.path)),
      )
    }

    const search = (session: ClaudeSessionId) =>
      Effect.forEach(roots, projectDirectories, { concurrency: 'unbounded' }).pipe(
        Effect.map(Arr.flatten),
        Effect.flatMap((directories) =>
          Effect.forEach(directories, (directory) => fileIn(directory, session), {
            concurrency: 'unbounded',
          }),
        ),
        Effect.map(Arr.getSomes),
        Effect.map(Arr.head),
      )

    const locate = Effect.fn('TranscriptLocator.locate')(function* (session: ClaudeSessionId) {
      return yield* search(yield* validSession(session))
    })

    const watchProjectDirectory = (directory: string, session: ClaudeSessionId) =>
      watch
        .watchReady(directory)
        .pipe(
          Stream.mapError(unreadable(directory)),
          Stream.filter(readyOr((name) => name === `${session}${TRANSCRIPT_EXTENSION}`)),
        )

    const rootTriggers = (root: string, session: ClaudeSessionId) => {
      const projects = path.join(root, PROJECTS_DIRECTORY)

      return Stream.unwrap(
        watch.awaitPath(projects).pipe(
          Effect.mapError(unreadable(projects)),
          Effect.as(
            watch.watchReady(projects).pipe(
              Stream.mapError(unreadable(projects)),
              Stream.switchMap(() =>
                Stream.unwrap(
                  Effect.map(projectDirectories(root), (directories) =>
                    Stream.mergeAll(
                      Arr.map(directories, (directory) =>
                        watchProjectDirectory(directory, session),
                      ),
                      { concurrency: 'unbounded' },
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      )
    }

    const awaitSession = Effect.fn('TranscriptLocator.await')(function* (session: ClaudeSessionId) {
      const valid = yield* validSession(session)
      const found = yield* pipe(
        Stream.mergeAll(
          Arr.map(roots, (root) => rootTriggers(root, valid)),
          { concurrency: 'unbounded' },
        ),
        Stream.buffer({ capacity: 1, strategy: 'sliding' }),
        Stream.mapEffect(() => search(valid)),
        Stream.filter(Option.isSome),
        Stream.runHead,
      )

      return yield* Option.match(Option.flatten(found), {
        onNone: () => Effect.never,
        onSome: Effect.succeed,
      })
    })

    const awaitSubagent = Effect.fn('TranscriptLocator.awaitSubagent')(function* (
      file: TranscriptFile,
      subagent: SubagentId,
    ) {
      const target = subagentFileOf(path, file, subagent)

      yield* watch.awaitPath(target.path).pipe(Effect.mapError(unreadable(target.path)))

      return target
    })

    return TranscriptLocator.of({ locate, await: awaitSession, awaitSubagent })
  })

export class TranscriptLocator extends Context.Service<
  TranscriptLocator,
  {
    readonly locate: (
      session: ClaudeSessionId,
    ) => Effect.Effect<Option.Option<TranscriptFile>, LocateError>
    readonly await: (session: ClaudeSessionId) => Effect.Effect<TranscriptFile, LocateError>
    readonly awaitSubagent: (
      file: TranscriptFile,
      subagent: SubagentId,
    ) => Effect.Effect<TranscriptFile, TranscriptDirectoryUnreadable>
  }
>()('@crook/claude/TranscriptLocator') {
  static readonly layerAt = (roots: readonly string[]) =>
    Layer.effect(this, make(roots)).pipe(Layer.provide(FileWatch.layer))

  static readonly layer = Layer.unwrap(Effect.map(claudeRoots, (roots) => this.layerAt(roots)))
}
