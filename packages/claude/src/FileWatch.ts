import * as Deferred from 'effect/Deferred'
import * as Effect from 'effect/Effect'
import type * as FileSystem from 'effect/FileSystem'
import * as Option from 'effect/Option'
import type { PlatformError } from 'effect/PlatformError'
import * as Stream from 'effect/Stream'

const PATH_SEPARATOR = '/'

export const baseName = (path: string) => path.slice(path.lastIndexOf(PATH_SEPARATOR) + 1)

export const parentOf = (path: string) =>
  path.slice(0, Math.max(path.lastIndexOf(PATH_SEPARATOR), 0)) || PATH_SEPARATOR

export const watchReady = (
  fileSystem: FileSystem.FileSystem,
  path: string,
): Stream.Stream<Option.Option<string>, PlatformError> =>
  Stream.unwrap(
    Effect.map(Deferred.make<void>(), (ready) =>
      Stream.merge(
        Stream.fromEffect(Deferred.await(ready)).pipe(Stream.as(Option.none<string>())),
        fileSystem
          .watch(path, {
            onReady: () => {
              Deferred.doneUnsafe(ready, Effect.void)
            },
          })
          .pipe(Stream.map((event) => Option.some(baseName(event.path)))),
      ),
    ),
  )

const isReadyOr =
  (name: string) =>
  (event: Option.Option<string>): boolean =>
    Option.match(event, { onNone: () => true, onSome: (changed) => changed === name })

export const awaitPath = (
  fileSystem: FileSystem.FileSystem,
  path: string,
): Effect.Effect<void, PlatformError> =>
  Effect.flatMap(fileSystem.exists(path), (exists) =>
    exists
      ? Effect.void
      : awaitPath(fileSystem, parentOf(path)).pipe(
          Effect.andThen(
            watchReady(fileSystem, parentOf(path)).pipe(
              Stream.filter(isReadyOr(baseName(path))),
              Stream.mapEffect(() => fileSystem.exists(path)),
              Stream.filter((appeared) => appeared),
              Stream.runHead,
            ),
          ),
          Effect.flatMap(
            Option.match({
              onNone: () => awaitPath(fileSystem, path),
              onSome: () => Effect.void,
            }),
          ),
        ),
  )
