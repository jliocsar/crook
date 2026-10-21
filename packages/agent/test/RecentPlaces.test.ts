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

  it('keeps only the most recent folders up to the capacity', () => {
    const folders = Arr.makeBy(RECENT_PLACES_CAPACITY + 1, (index) =>
      used(`/home/jliocsar/Projects/repo-${index}`, DateTime.add(EARLIER, { minutes: index })),
    )
    const kept = mergeUsedFolders([], folders)

    expect(kept).toHaveLength(RECENT_PLACES_CAPACITY)
    expect(kept.map((entry) => entry.folder)).not.toContain('/home/jliocsar/Projects/repo-0')
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
          yield* first.observe([agentRow({ cwd: plain, statusChangedAt: EARLIER })])
          const published = yield* first.current
          const restarted = yield* recentPlacesAt(file, branches)

          expect(published).toEqual([
            new Place({
              folder: repository,
              checkout: Option.some(new Checkout({ branch: Option.some(BRANCH) })),
              usedAt: LATER,
            }),
            new Place({ folder: plain, checkout: Option.none(), usedAt: EARLIER }),
          ])
          expect(yield* restarted.current).toEqual(published)
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

        yield* places.observe([
          agentRow({ cwd: removed, statusChangedAt: LATER }),
          agentRow({ pane: PaneId.make('w1:p2'), cwd: kept, statusChangedAt: EARLIER }),
        ])
        const before = yield* places.current

        yield* fileSystem.remove(removed, { recursive: true })
        yield* places.observe([agentRow({ cwd: kept, statusChangedAt: EARLIER })])

        expect(before.map((place) => place.folder)).toEqual([removed, kept])
        expect((yield* places.current).map((place) => place.folder)).toEqual([kept])
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
          const before = yield* places.current

          yield* places.observe([agentRow({ cwd: folder, statusChangedAt: LATER })])
          const restarted = yield* recentPlacesAt(file)

          expect(before).toEqual([])
          expect((yield* restarted.current).map((place) => place.folder)).toEqual([folder])
        }),
    )
  },
)
