import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as HashSet from 'effect/HashSet'
import * as Layer from 'effect/Layer'
import * as Schema from 'effect/Schema'
import * as Semaphore from 'effect/Semaphore'
import type * as Stream from 'effect/Stream'
import * as SubscriptionRef from 'effect/SubscriptionRef'

import { makeEnsureParentDirectory, stateFile } from '@crook/agent/StateDirectory'
import { PaneId } from '@crook/domain/Ids'

const TEMPORARY_SUFFIX = '.tmp'

export const CrookCreatedPanesPath = stateFile('CROOK_CREATED_PANES_PATH', 'created-panes.json')

const CreatedPanesFile = Schema.fromJsonString(Schema.Array(PaneId))

export class CreatedPanesUnwritable extends Schema.TaggedError<CreatedPanesUnwritable>()(
  'CreatedPanesUnwritable',
  { path: Schema.String, cause: Schema.Defect() },
) {
  override get message(): string {
    return `Could not save the panes crook created to ${this.path}, so the record stays as it was: a pane crook just created will need a confirmed close, or a pane just closed stays listed. Check the disk and the permissions of that file, or point CROOK_CREATED_PANES_PATH elsewhere.`
  }
}

export class CreatedPanesUnreadable extends Schema.TaggedError<CreatedPanesUnreadable>()(
  'CreatedPanesUnreadable',
  { path: Schema.String, cause: Schema.Defect() },
) {
  override get message(): string {
    return `Could not read the panes crook created from ${this.path}, so crook starts as if it had created none and asks for confirmation before closing any pane. Check that file, or move it aside to start a fresh record.`
  }
}

const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem
  const ensureParentDirectory = yield* makeEnsureParentDirectory
  const file = yield* CrookCreatedPanesPath
  const writing = yield* Semaphore.make(1)

  const stored = yield* fileSystem.readFileString(file).pipe(
    Effect.flatMap(Schema.decodeEffect(CreatedPanesFile)),
    Effect.map(HashSet.fromIterable),
    Effect.catchReason('PlatformError', 'NotFound', () => Effect.succeed(HashSet.empty<PaneId>())),
    Effect.catch((cause) =>
      Effect.as(
        Effect.logWarning(new CreatedPanesUnreadable({ path: file, cause }).message),
        HashSet.empty<PaneId>(),
      ),
    ),
  )
  const panes = yield* SubscriptionRef.make(stored)

  const save = (next: HashSet.HashSet<PaneId>) => {
    const temporary = `${file}${TEMPORARY_SUFFIX}`

    return ensureParentDirectory(file).pipe(
      Effect.andThen(
        fileSystem.writeFileString(
          temporary,
          Schema.encodeSync(CreatedPanesFile)(Array.from(next)),
        ),
      ),
      Effect.andThen(fileSystem.rename(temporary, file)),
      Effect.mapError((cause) => new CreatedPanesUnwritable({ path: file, cause })),
    )
  }

  const change = (update: (current: HashSet.HashSet<PaneId>) => HashSet.HashSet<PaneId>) =>
    writing.withPermits(1)(
      Effect.gen(function* () {
        const current = yield* SubscriptionRef.get(panes)
        const next = update(current)

        if (HashSet.size(next) === HashSet.size(current)) {
          return
        }

        yield* save(next)
        yield* SubscriptionRef.set(panes, next)
      }),
    )

  return CreatedPanes.of({
    ...CreatedPanes.readingFrom(panes),
    remember: (pane) => change(HashSet.add(pane)).pipe(Effect.withSpan('CreatedPanes.remember')),
    forget: (pane) => change(HashSet.remove(pane)).pipe(Effect.withSpan('CreatedPanes.forget')),
  })
})

export class CreatedPanes extends Context.Service<
  CreatedPanes,
  {
    readonly current: Effect.Effect<HashSet.HashSet<PaneId>>
    readonly changes: Stream.Stream<HashSet.HashSet<PaneId>>
    readonly has: (pane: PaneId) => Effect.Effect<boolean>
    readonly remember: (pane: PaneId) => Effect.Effect<void, CreatedPanesUnwritable>
    readonly forget: (pane: PaneId) => Effect.Effect<void, CreatedPanesUnwritable>
  }
>()('@crook/agent/CreatedPanes') {
  static readonly layer = Layer.effect(this, make)

  static readonly readingFrom = (
    panes: SubscriptionRef.SubscriptionRef<HashSet.HashSet<PaneId>>,
  ) => ({
    current: SubscriptionRef.get(panes),
    changes: SubscriptionRef.changes(panes),
    has: (pane: PaneId) => Effect.map(SubscriptionRef.get(panes), HashSet.has(pane)),
  })

  static readonly layerTest = (created: Iterable<PaneId> = []) =>
    Layer.effect(
      this,
      Effect.map(SubscriptionRef.make(HashSet.fromIterable(created)), (panes) =>
        CreatedPanes.of({
          ...CreatedPanes.readingFrom(panes),
          remember: (pane) => SubscriptionRef.update(panes, HashSet.add(pane)),
          forget: (pane) => SubscriptionRef.update(panes, HashSet.remove(pane)),
        }),
      ),
    )
}
