import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as HashSet from 'effect/HashSet'
import * as Layer from 'effect/Layer'
import * as Schema from 'effect/Schema'
import * as Semaphore from 'effect/Semaphore'
import type * as Stream from 'effect/Stream'
import * as SubscriptionRef from 'effect/SubscriptionRef'

import { makeWriteAtomically, stateFile } from '@crook/agent/StateDirectory'
import { PaneId } from '@crook/domain/Ids'

const UNREADABLE_SUFFIX = '.unreadable'

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
  { path: Schema.String, setAsidePath: Schema.String, cause: Schema.Defect() },
) {
  override get message(): string {
    return `Could not read the panes crook created from ${this.path}, so it was moved to ${this.setAsidePath} and crook starts as if it had created none, asking for confirmation before closing any pane. A read can fail for a passing reason too, leaving the moved file intact: inspect it, add back any pane ids still wanted while the agent is stopped, and delete it once its record is no longer wanted.`
  }
}

export class CreatedPanesNotSetAside extends Schema.TaggedError<CreatedPanesNotSetAside>()(
  'CreatedPanesNotSetAside',
  { path: Schema.String, setAsidePath: Schema.String, cause: Schema.Defect() },
) {
  override get message(): string {
    return `Could not read the panes crook created from ${this.path}, nor move it to ${this.setAsidePath}, so crook starts as if it had created none and the next pane it creates or closes replaces that file. Copy the file elsewhere now to keep it, and check the permissions of its folder.`
  }
}

const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem
  const writeAtomically = yield* makeWriteAtomically
  const file = yield* CrookCreatedPanesPath
  const unreadableFile = `${file}${UNREADABLE_SUFFIX}`
  const writing = yield* Semaphore.make(1)

  const stored = yield* fileSystem.readFileString(file).pipe(
    Effect.flatMap(Schema.decodeEffect(CreatedPanesFile)),
    Effect.map(HashSet.fromIterable),
    Effect.catchReason('PlatformError', 'NotFound', () => Effect.succeed(HashSet.empty<PaneId>())),
    Effect.catch((cause) =>
      fileSystem.rename(file, unreadableFile).pipe(
        Effect.andThen(
          Effect.logWarning(
            new CreatedPanesUnreadable({ path: file, setAsidePath: unreadableFile, cause }).message,
          ),
        ),
        Effect.catch((moveFailure) =>
          Effect.logWarning(
            new CreatedPanesNotSetAside({
              path: file,
              setAsidePath: unreadableFile,
              cause: moveFailure,
            }).message,
          ),
        ),
        Effect.as(HashSet.empty<PaneId>()),
      ),
    ),
  )
  const panes = yield* SubscriptionRef.make(stored)

  const save = (next: HashSet.HashSet<PaneId>) =>
    writeAtomically(file, Schema.encodeSync(CreatedPanesFile)(Array.from(next))).pipe(
      Effect.mapError((cause) => new CreatedPanesUnwritable({ path: file, cause })),
    )

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
