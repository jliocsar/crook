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

const isStoredIn = (stored: readonly UsedFolder[]) => (seen: UsedFolder) =>
  Arr.some(stored, (entry) => entry.folder === seen.folder)

export const usesWorthRecording = (
  stored: readonly UsedFolder[],
  seen: readonly UsedFolder[],
  firstSightAt: DateTime.Utc,
): readonly UsedFolder[] =>
  Arr.filter(
    seen,
    (use) => DateTime.isGreaterThan(use.usedAt, firstSightAt) || !isStoredIn(stored)(use),
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

  const stillThere = (entry: UsedFolder) =>
    fileSystem
      .exists(entry.folder)
      .pipe(
        Effect.catchTag('PlatformError', (error) =>
          Effect.as(Effect.logWarning(error.message), true),
        ),
      )

  const keepPresent = (uses: readonly UsedFolder[]) =>
    Effect.forEach(
      uses,
      (entry) =>
        Effect.map(stillThere(entry), (present) =>
          present ? Option.some(entry) : Option.none<UsedFolder>(),
        ),
      { concurrency: 'unbounded' },
    ).pipe(Effect.map((kept) => pipe(kept, Arr.getSomes, Arr.take(RECENT_PLACES_CAPACITY))))

  const placeOf = (entry: UsedFolder) =>
    Effect.map(
      checkoutOf(entry.folder),
      (checkout) => new Place({ folder: entry.folder, checkout, usedAt: entry.usedAt }),
    )

  const save = Effect.fn('RecentPlaces.save')(function* (next: readonly UsedFolder[]) {
    return yield* Schema.encodeEffect(RecentPlacesFile)(next).pipe(
      Effect.flatMap((content) => writeAtomically(file, content)),
      Effect.catch((cause) =>
        Effect.logWarning(new RecentPlacesUnwritable({ path: file, cause }).message),
      ),
    )
  })

  const used = yield* Ref.make(stored)

  const observe = Effect.fn('RecentPlaces.observe')(function* (
    agents: readonly AgentRow[],
    firstSightAt: DateTime.Utc,
  ) {
    const current = yield* Ref.get(used)
    const seen = usesWorthRecording(current, foldersUsedBy(agents), firstSightAt)
    const next = yield* keepPresent(mergeUsedFolders(current, seen))

    if (!isSameUse(next, current)) {
      yield* save(next)
      yield* Ref.set(used, next)
    }

    return yield* Effect.forEach(next, placeOf, { concurrency: 'unbounded' })
  }, writing.withPermits(1))

  return RecentPlaces.of({ observe })
})

export class RecentPlaces extends Context.Service<
  RecentPlaces,
  {
    readonly observe: (
      agents: readonly AgentRow[],
      firstSightAt: DateTime.Utc,
    ) => Effect.Effect<readonly Place[]>
  }
>()('@crook/agent/RecentPlaces') {
  static readonly layer = Layer.effect(this, make)

  static readonly layerTest = (places: readonly Place[] = []) =>
    Layer.succeed(this, RecentPlaces.of({ observe: () => Effect.succeed(places) }))
}
