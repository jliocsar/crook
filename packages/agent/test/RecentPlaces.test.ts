import * as BunFileSystem from '@effect/platform-bun/BunFileSystem'
import * as BunPath from '@effect/platform-bun/BunPath'
import { describe, expect, it, layer } from '@effect/vitest'
import * as Arr from 'effect/Array'
import * as ConfigProvider from 'effect/ConfigProvider'
import * as Context from 'effect/Context'
import * as DateTime from 'effect/DateTime'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'

import { GitBranches } from '@crook/agent/GitBranches'
import {
  RECENT_PLACES_CAPACITY,
  RecentPlaces,
  UsedFolder,
  foldersUsedBy,
  mergeUsedFolders,
} from '@crook/agent/RecentPlaces'
import { makeEnsureParentDirectory } from '@crook/agent/StateDirectory'
import { PaneId } from '@crook/domain/Ids'
import { Checkout, Place } from '@crook/domain/Place'

import { agentRow } from './Fixtures'

const CROOK = '/home/jliocsar/Projects/crook'
const DOTFILES = '/home/jliocsar/.dotfiles'
const SCRATCH = '/home/jliocsar/scratch'
const BRANCH = 'feat/jc-111-new-agent'
const EARLIER = DateTime.makeUnsafe('2026-10-20T15:00:00Z')
const LATER = DateTime.makeUnsafe('2026-10-21T13:27:00Z')

const used = (folder: string, usedAt: DateTime.Utc) => new UsedFolder({ folder, usedAt })

const recentPlacesAt = Effect.fn('recentPlacesAt')(function* (
  file: string,
  branches: ReadonlyMap<string, string> = new Map(),
) {
  const context = yield* Layer.build(
    RecentPlaces.layer.pipe(
      Layer.provide([
        GitBranches.layerTest(branches),
        ConfigProvider.layer(ConfigProvider.fromUnknown({ CROOK_RECENT_PLACES_PATH: file })),
      ]),
    ),
  )

  return Context.get(context, RecentPlaces)
})

const scratchFile = Effect.fn('scratchFile')(function* () {
  const fileSystem = yield* FileSystem.FileSystem
  const directory = yield* fileSystem.makeTempDirectoryScoped()

  return `${directory}/state/crook/recent-places.json`
})

const scratchFolder = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem

  return yield* fileSystem.makeTempDirectoryScoped()
})

const foldersIn = Effect.fn('foldersIn')(function* (count: number) {
  const fileSystem = yield* FileSystem.FileSystem
  const parent = yield* scratchFolder
  const folders = Arr.makeBy(count, (index) => `${parent}/folder-${index}`)

  yield* Effect.forEach(folders, (folder) => fileSystem.makeDirectory(folder), { discard: true })

  return folders
})

describe('mergeUsedFolders', () => {
  it('keeps one entry per folder, at its latest use, most recent first', () => {
    expect(
      mergeUsedFolders(
        [used(CROOK, EARLIER), used(DOTFILES, EARLIER)],
        [used(CROOK, LATER), used(SCRATCH, EARLIER)],
      ),
    ).toEqual([used(CROOK, LATER), used(DOTFILES, EARLIER), used(SCRATCH, EARLIER)])
  })

  it('never moves a folder back to an older use', () => {
    expect(mergeUsedFolders([used(CROOK, LATER)], [used(CROOK, EARLIER)])).toEqual([
      used(CROOK, LATER),
    ])
  })

  it('takes a folder from each agent with a working directory, at its last status change', () => {
    expect(
      foldersUsedBy([agentRow({ cwd: CROOK, statusChangedAt: LATER }), agentRow({ cwd: '' })]),
    ).toEqual([used(CROOK, LATER)])
  })
})

layer(Layer.mergeAll(BunFileSystem.layer, BunPath.layer), { excludeTestServices: true })(
  'RecentPlaces',
  (onDisk) => {
    const agentsIn = (folders: readonly string[]) =>
      folders.map((folder, index) =>
        agentRow({ cwd: folder, statusChangedAt: DateTime.add(EARLIER, { minutes: index }) }),
      )

    onDisk.effect(
      'publishes the folders agents used with their checkout, and keeps them across a restart',
      () =>
        Effect.gen(function* () {
          const file = yield* scratchFile()
          const repository = yield* scratchFolder
          const plain = yield* scratchFolder
          const branches = new Map([[repository, BRANCH]])
          const first = yield* recentPlacesAt(file, branches)

          yield* first.observe([agentRow({ cwd: repository, statusChangedAt: LATER })])
          const published = yield* first.observe([
            agentRow({ cwd: plain, statusChangedAt: EARLIER }),
          ])
          const restarted = yield* recentPlacesAt(file, branches)

          expect(published).toEqual([
            new Place({
              folder: repository,
              checkout: Option.some(new Checkout({ branch: Option.some(BRANCH) })),
              usedAt: LATER,
            }),
            new Place({ folder: plain, checkout: Option.none(), usedAt: EARLIER }),
          ])
          expect(yield* restarted.observe([])).toEqual(published)
        }),
    )

    onDisk.effect('leaves out a folder that no longer exists, such as a removed worktree', () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem
        const file = yield* scratchFile()
        const kept = yield* scratchFolder
        const removed = `${yield* scratchFolder}/fix-reconnect`

        yield* fileSystem.makeDirectory(removed)
        const places = yield* recentPlacesAt(file)
        const before = yield* places.observe([
          agentRow({ cwd: removed, statusChangedAt: LATER }),
          agentRow({ pane: PaneId.make('w1:p2'), cwd: kept, statusChangedAt: EARLIER }),
        ])

        yield* fileSystem.remove(removed, { recursive: true })
        const after = yield* places.observe([agentRow({ cwd: kept, statusChangedAt: EARLIER })])

        expect(before.map((place) => place.folder)).toEqual([removed, kept])
        expect(after.map((place) => place.folder)).toEqual([kept])
      }),
    )

    onDisk.effect('keeps only the most recent folders up to the capacity', () =>
      Effect.gen(function* () {
        const file = yield* scratchFile()
        const folders = yield* foldersIn(RECENT_PLACES_CAPACITY + 1)
        const places = yield* recentPlacesAt(file)
        const kept = yield* places.observe(agentsIn(folders))

        expect(kept).toHaveLength(RECENT_PLACES_CAPACITY)
        expect(kept.map((place) => place.folder)).not.toContain(folders[0])
      }),
    )

    onDisk.effect("gives a removed folder's slot to the next folder that still exists", () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem
        const file = yield* scratchFile()
        const folders = yield* foldersIn(RECENT_PLACES_CAPACITY + 1)
        const removed = Arr.getUnsafe(folders, 1)
        const places = yield* recentPlacesAt(file)

        yield* places.observe(agentsIn(Arr.take(folders, RECENT_PLACES_CAPACITY)))
        yield* fileSystem.remove(removed, { recursive: true })
        const after = yield* places.observe([
          agentRow({
            cwd: Arr.getUnsafe(folders, RECENT_PLACES_CAPACITY),
            statusChangedAt: LATER,
          }),
        ])
        const restarted = yield* recentPlacesAt(file)

        expect(after).toHaveLength(RECENT_PLACES_CAPACITY)
        expect(after.map((place) => place.folder)).toContain(folders[0])
        expect(after.map((place) => place.folder)).not.toContain(removed)
        expect(yield* restarted.observe([])).toEqual(after)
      }),
    )

    onDisk.effect(
      'starts empty from a record it cannot read, and replaces it on the next use',
      () =>
        Effect.gen(function* () {
          const fileSystem = yield* FileSystem.FileSystem
          const ensureParentDirectory = yield* makeEnsureParentDirectory
          const file = yield* scratchFile()

          const folder = yield* scratchFolder

          yield* ensureParentDirectory(file)
          yield* fileSystem.writeFileString(file, '[{"folder":')
          const places = yield* recentPlacesAt(file)
          const before = yield* places.observe([])

          yield* places.observe([agentRow({ cwd: folder, statusChangedAt: LATER })])
          const restarted = yield* recentPlacesAt(file)

          expect(before).toEqual([])
          expect((yield* restarted.observe([])).map((place) => place.folder)).toEqual([folder])
        }),
    )
  },
)
