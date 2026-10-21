import * as Arr from 'effect/Array'
import * as Context from 'effect/Context'
import * as DateTime from 'effect/DateTime'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import { pipe } from 'effect/Function'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Order from 'effect/Order'
import * as Record from 'effect/Record'
import * as Ref from 'effect/Ref'
import * as Schema from 'effect/Schema'
import * as Semaphore from 'effect/Semaphore'
import type * as Stream from 'effect/Stream'
import * as SubscriptionRef from 'effect/SubscriptionRef'

import { GitBranches } from '@crook/agent/GitBranches'
import { makeWriteAtomically, stateFile } from '@crook/agent/StateDirectory'
import type { AgentRow } from '@crook/domain/AgentRow'
import { Checkout, Place, byMostRecentUse } from '@crook/domain/Place'

export const RECENT_PLACES_CAPACITY = 15

export const CrookRecentPlacesPath = stateFile('CROOK_RECENT_PLACES_PATH', 'recent-places.json')

export class UsedFolder extends Schema.Class<UsedFolder>('UsedFolder')({
  folder: Schema.String,
  usedAt: Schema.DateTimeUtcFromString,
}) {}

const RecentPlacesFile = Schema.fromJsonString(Schema.Array(UsedFolder))

const isSameUse = Schema.toEquivalence(Schema.Array(UsedFolder))
const isSamePlaces = Schema.toEquivalence(Schema.Array(Place))

const byMostRecentUseThenFolder = Order.combine(
  byMostRecentUse,
  Order.mapInput(Order.String, (used: UsedFolder) => used.folder),
)

export class RecentPlacesUnreadable extends Schema.TaggedError<RecentPlacesUnreadable>()(
  'RecentPlacesUnreadable',
  { path: Schema.String, cause: Schema.Defect() },
) {
  override get message(): string {
    return `Could not read the recent folders from ${this.path}, so the phone starts from the folders of the agents running now, and the next change replaces the file. Check the file, or point CROOK_RECENT_PLACES_PATH elsewhere.`
  }
}

export class RecentPlacesUnwritable extends Schema.TaggedError<RecentPlacesUnwritable>()(
  'RecentPlacesUnwritable',
  { path: Schema.String, cause: Schema.Defect() },
) {
  override get message(): string {
    return `Could not save the recent folders to ${this.path}, so a restart forgets the folders no agent runs in now. Check the disk and the permissions of that file, or point CROOK_RECENT_PLACES_PATH elsewhere.`
  }
}

export const foldersUsedBy = (agents: readonly AgentRow[]): readonly UsedFolder[] =>
  pipe(
    agents,
    Arr.filter((row) => row.cwd !== ''),
    Arr.map((row) => new UsedFolder({ folder: row.cwd, usedAt: row.statusChangedAt })),
  )

const latestUse = (uses: Arr.NonEmptyReadonlyArray<UsedFolder>): UsedFolder =>
  Arr.max(
    uses,
    Order.mapInput(DateTime.Order, (used: UsedFolder) => used.usedAt),
  )

export const mergeUsedFolders = (
  stored: readonly UsedFolder[],
  seen: readonly UsedFolder[],
): readonly UsedFolder[] =>
  pipe(
    stored,
    Arr.appendAll(seen),
    Arr.groupBy((used) => used.folder),
    Record.values,
    Arr.map(latestUse),
    Arr.sort(byMostRecentUseThenFolder),
    Arr.take(RECENT_PLACES_CAPACITY),
  )

const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem
  const gitBranches = yield* GitBranches
  const writeAtomically = yield* makeWriteAtomically
  const file = yield* CrookRecentPlacesPath
  const writing = yield* Semaphore.make(1)

  const stored = yield* fileSystem.readFileString(file).pipe(
    Effect.flatMap(Schema.decodeEffect(RecentPlacesFile)),
    Effect.catchReason('PlatformError', 'NotFound', () => Effect.succeed([])),
    Effect.catch((cause) =>
      Effect.as(Effect.logWarning(new RecentPlacesUnreadable({ path: file, cause }).message), []),
    ),
  )

  const checkoutOf = (folder: string) =>
    gitBranches.checkoutOf(folder).pipe(
      Effect.map(Option.map((found) => new Checkout({ branch: found.branch }))),
      Effect.catchTag('GitMetadataUnreadable', (error) =>
        Effect.as(Effect.logWarning(error.message), Option.none<Checkout>()),
      ),
    )

  const stillThere = (folder: string) =>
    fileSystem
      .exists(folder)
      .pipe(
        Effect.catchTag('PlatformError', (error) =>
          Effect.as(Effect.logWarning(error.message), true),
        ),
      )

  const placeOf = (entry: UsedFolder) =>
    Effect.map(
      checkoutOf(entry.folder),
      (checkout) => new Place({ folder: entry.folder, checkout, usedAt: entry.usedAt }),
    )

  const resolvePlaces = (used: readonly UsedFolder[]) =>
    Effect.forEach(
      used,
      (entry) =>
        stillThere(entry.folder).pipe(
          Effect.flatMap((present) =>
            present ? Effect.map(placeOf(entry), Option.some) : Effect.succeedNone,
          ),
        ),
      { concurrency: 'unbounded' },
    ).pipe(Effect.map(Arr.getSomes))

  const save = Effect.fn('RecentPlaces.save')(function* (next: readonly UsedFolder[]) {
    return yield* Schema.encodeEffect(RecentPlacesFile)(next).pipe(
      Effect.flatMap((content) => writeAtomically(file, content)),
      Effect.catch((cause) =>
        Effect.logWarning(new RecentPlacesUnwritable({ path: file, cause }).message),
      ),
    )
  })

  const used = yield* Ref.make(stored)
  const places = yield* SubscriptionRef.make<readonly Place[]>(yield* resolvePlaces(stored))

  const observe = (agents: readonly AgentRow[]) =>
    writing.withPermits(1)(
      Effect.gen(function* () {
        const current = yield* Ref.get(used)
        const next = mergeUsedFolders(current, foldersUsedBy(agents))

        if (!isSameUse(next, current)) {
          yield* save(next)
          yield* Ref.set(used, next)
        }

        const resolved = yield* resolvePlaces(next)

        if (!isSamePlaces(resolved, yield* SubscriptionRef.get(places))) {
          yield* SubscriptionRef.set(places, resolved)
        }
      }),
    )

  return RecentPlaces.of({
    ...RecentPlaces.readingFrom(places),
    observe: (agents) => observe(agents).pipe(Effect.withSpan('RecentPlaces.observe')),
  })
})

export class RecentPlaces extends Context.Service<
  RecentPlaces,
  {
    readonly current: Effect.Effect<readonly Place[]>
    readonly changes: Stream.Stream<readonly Place[]>
    readonly observe: (agents: readonly AgentRow[]) => Effect.Effect<void>
  }
>()('@crook/agent/RecentPlaces') {
  static readonly layer = Layer.effect(this, make)

  static readonly readingFrom = (places: SubscriptionRef.SubscriptionRef<readonly Place[]>) => ({
    current: SubscriptionRef.get(places),
    changes: SubscriptionRef.changes(places),
  })

  static readonly layerTest = (initial: readonly Place[] = []) =>
    Layer.effect(
      this,
      Effect.map(SubscriptionRef.make<readonly Place[]>(initial), (places) =>
        RecentPlaces.of({
          ...RecentPlaces.readingFrom(places),
          observe: () => Effect.void,
        }),
      ),
    )
}
