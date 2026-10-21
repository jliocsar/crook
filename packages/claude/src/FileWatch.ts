import * as Context from 'effect/Context'
import * as Deferred from 'effect/Deferred'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import type { PlatformError } from 'effect/PlatformError'
import * as Stream from 'effect/Stream'

export const readyOr =
  (changed: (name: string) => boolean) =>
  (event: Option.Option<string>): boolean =>
    Option.match(event, { onNone: () => true, onSome: changed })

const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem
  const path = yield* Path.Path

  const watchReady = (target: string): Stream.Stream<Option.Option<string>, PlatformError> =>
    Stream.unwrap(
      Effect.map(Deferred.make<void>(), (ready) =>
        Stream.merge(
          Stream.fromEffect(Deferred.await(ready)).pipe(Stream.as(Option.none<string>())),
          fileSystem
            .watch(target, {
              onReady: () => {
                Deferred.doneUnsafe(ready, Effect.void)
              },
            })
            .pipe(Stream.map((event) => Option.some(path.basename(event.path)))),
        ),
      ),
    )

  const awaitPath = (target: string): Effect.Effect<void, PlatformError> => {
    const parent = path.dirname(target)

    return Effect.flatMap(fileSystem.exists(target), (exists) =>
      exists
        ? Effect.void
        : awaitPath(parent).pipe(
            Effect.andThen(
              watchReady(parent).pipe(
                Stream.filter(readyOr((name) => name === path.basename(target))),
                Stream.mapEffect(() => fileSystem.exists(target)),
                Stream.filter((appeared) => appeared),
                Stream.runHead,
              ),
            ),
            Effect.flatMap(
              Option.match({
                onNone: () => awaitPath(target),
                onSome: () => Effect.void,
              }),
            ),
          ),
    )
  }

  return FileWatch.of({ watchReady, awaitPath })
})

export class FileWatch extends Context.Service<
  FileWatch,
  {
    readonly watchReady: (target: string) => Stream.Stream<Option.Option<string>, PlatformError>
    readonly awaitPath: (target: string) => Effect.Effect<void, PlatformError>
  }
>()('@crook/claude/FileWatch') {
  static readonly layer = Layer.effect(this, make)
}
