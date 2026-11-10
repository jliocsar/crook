import * as BunFileSystem from '@effect/platform-bun/BunFileSystem'
import { expect, layer } from '@effect/vitest'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'

import { GitBranches, GitMetadataUnreadable } from '@crook/agent/GitBranches'

const BRANCH = 'feat/jc-97-98-registry-seen'
const DETACHED_HEAD = 'b3f1c2d0e9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4\n'

const branchHead = (branch: string) => `ref: refs/heads/${branch}\n`

const checkout = Effect.fn('checkout')(function* (head: string) {
  const fileSystem = yield* FileSystem.FileSystem
  const root = yield* fileSystem.makeTempDirectoryScoped()

  yield* fileSystem.makeDirectory(`${root}/repo/.git`, { recursive: true })
  yield* fileSystem.makeDirectory(`${root}/repo/packages/agent`, { recursive: true })
  yield* fileSystem.writeFileString(`${root}/repo/.git/HEAD`, head)

  return root
})

const branchOf = Effect.fn('branchOf')(function* (cwd: string) {
  const gitBranches = yield* GitBranches

  return Option.flatMap(yield* gitBranches.checkoutOf(cwd), (found) => found.branch)
})

const services = Layer.mergeAll(BunFileSystem.layer, Path.layer)

layer(Layer.provideMerge(GitBranches.layer, services), { excludeTestServices: true })(
  'GitBranches',
  (live) => {
    live.effect('reads the branch from the checkout the folder sits in', () =>
      Effect.gen(function* () {
        const root = yield* checkout(branchHead(BRANCH))

        expect(yield* branchOf(`${root}/repo`)).toEqual(Option.some(BRANCH))
        expect(yield* branchOf(`${root}/repo/packages/agent`)).toEqual(Option.some(BRANCH))
      }),
    )

    live.effect('follows a linked worktree to its own HEAD', () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem
        const root = yield* checkout(branchHead('main'))

        yield* fileSystem.makeDirectory(`${root}/repo/.git/worktrees/herd`, { recursive: true })
        yield* fileSystem.writeFileString(
          `${root}/repo/.git/worktrees/herd/HEAD`,
          branchHead(BRANCH),
        )
        yield* fileSystem.makeDirectory(`${root}/herd`)
        yield* fileSystem.writeFileString(
          `${root}/herd/.git`,
          'gitdir: ../repo/.git/worktrees/herd\n',
        )

        expect(yield* branchOf(`${root}/herd`)).toEqual(Option.some(BRANCH))
      }),
    )

    live.effect('sees a checkout of another branch at the next read', () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem
        const root = yield* checkout(branchHead('main'))
        const before = yield* branchOf(`${root}/repo`)

        yield* fileSystem.writeFileString(`${root}/repo/.git/HEAD`, branchHead(BRANCH))

        expect(before).toEqual(Option.some('main'))
        expect(yield* branchOf(`${root}/repo`)).toEqual(Option.some(BRANCH))
      }),
    )

    live.effect('has no branch for a detached HEAD, a folder outside git or no folder', () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem
        const detached = yield* checkout(DETACHED_HEAD)
        const outside = yield* fileSystem.makeTempDirectoryScoped()

        expect(yield* branchOf(`${detached}/repo`)).toEqual(Option.none())
        expect(yield* branchOf(outside)).toEqual(Option.none())
        expect(yield* branchOf('')).toEqual(Option.none())
      }),
    )

    live.effect('tells a detached checkout from a folder outside git, and names its root', () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem
        const gitBranches = yield* GitBranches
        const detached = yield* checkout(DETACHED_HEAD)
        const outside = yield* fileSystem.makeTempDirectoryScoped()

        expect(yield* gitBranches.checkoutOf(`${detached}/repo/packages/agent`)).toEqual(
          Option.some({
            root: `${detached}/repo`,
            gitDirectory: `${detached}/repo/.git`,
            branch: Option.none(),
          }),
        )
        expect(yield* gitBranches.checkoutOf(outside)).toEqual(Option.none())
      }),
    )

    live.effect('finds a checkout made in a folder after an earlier read found none', () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem
        const folder = yield* fileSystem.makeTempDirectoryScoped()
        const before = yield* branchOf(folder)

        yield* fileSystem.makeDirectory(`${folder}/.git`)
        yield* fileSystem.writeFileString(`${folder}/.git/HEAD`, branchHead(BRANCH))

        expect(before).toEqual(Option.none())
        expect(yield* branchOf(folder)).toEqual(Option.some(BRANCH))
      }),
    )

    live.effect('looks again when a linked worktree is re-added under new metadata', () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem
        const root = yield* checkout(branchHead('main'))
        const linkWorktree = Effect.fn('linkWorktree')(function* (name: string, branch: string) {
          yield* fileSystem.makeDirectory(`${root}/repo/.git/worktrees/${name}`, {
            recursive: true,
          })
          yield* fileSystem.writeFileString(
            `${root}/repo/.git/worktrees/${name}/HEAD`,
            branchHead(branch),
          )
          yield* fileSystem.writeFileString(
            `${root}/herd/.git`,
            `gitdir: ../repo/.git/worktrees/${name}\n`,
          )
        })

        yield* fileSystem.makeDirectory(`${root}/herd`)
        yield* linkWorktree('herd', 'main')
        const before = yield* branchOf(`${root}/herd`)

        yield* fileSystem.remove(`${root}/repo/.git/worktrees/herd`, { recursive: true })
        yield* linkWorktree('herd1', BRANCH)

        expect(before).toEqual(Option.some('main'))
        expect(yield* branchOf(`${root}/herd`)).toEqual(Option.some(BRANCH))
      }),
    )

    live.effect('fails with GitMetadataUnreadable when HEAD exists but cannot be read', () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem
        const root = yield* checkout(branchHead(BRANCH))

        yield* fileSystem.remove(`${root}/repo/.git/HEAD`)
        yield* fileSystem.makeDirectory(`${root}/repo/.git/HEAD`)
        const failure = yield* branchOf(`${root}/repo`).pipe(Effect.flip)

        expect(failure).toBeInstanceOf(GitMetadataUnreadable)
        expect(failure.path).toBe(`${root}/repo/.git/HEAD`)
      }),
    )
  },
)
