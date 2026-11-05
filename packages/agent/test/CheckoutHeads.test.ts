import * as BunFileSystem from '@effect/platform-bun/BunFileSystem'
import { expect, layer } from '@effect/vitest'
import * as Context from 'effect/Context'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as HashSet from 'effect/HashSet'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as Queue from 'effect/Queue'
import * as Ref from 'effect/Ref'
import * as Stream from 'effect/Stream'

import { CheckoutHeads } from '@crook/agent/CheckoutHeads'
import { GitBranches } from '@crook/agent/GitBranches'
import { FileWatch } from '@crook/claude/FileWatch'

const NOTHING_MOVED_WAIT = Duration.millis(150)
const MOVE_WAIT = Duration.seconds(5)

const services = Layer.mergeAll(BunFileSystem.layer, Path.layer)
const branches = Layer.provide(GitBranches.layer, services)

const branchHead = (branch: string) => `ref: refs/heads/${branch}\n`

const awaitMove = (heads: CheckoutHeads['Service']) =>
  heads.changes.pipe(
    Stream.runHead,
    Effect.timeoutOrElse({ duration: MOVE_WAIT, orElse: () => Effect.succeedNone }),
    Effect.map(Option.isSome),
  )

const staysStill = (heads: CheckoutHeads['Service']) =>
  heads.changes.pipe(
    Stream.runHead,
    Effect.timeoutOrElse({
      duration: NOTHING_MOVED_WAIT,
      orElse: () => Effect.succeedNone,
    }),
    Effect.map(Option.isNone),
  )

const checkoutOn = Effect.fn('checkoutOn')(function* (branch: string) {
  const fileSystem = yield* FileSystem.FileSystem
  const root = yield* fileSystem.makeTempDirectoryScoped()

  yield* fileSystem.makeDirectory(`${root}/.git`)
  yield* fileSystem.makeDirectory(`${root}/packages/agent`, { recursive: true })
  yield* fileSystem.writeFileString(`${root}/.git/HEAD`, branchHead(branch))

  return root
})

const moveHead = Effect.fn('moveHead')(function* (root: string, head: string) {
  const fileSystem = yield* FileSystem.FileSystem

  yield* fileSystem.writeFileString(`${root}/.git/HEAD.lock`, head)
  yield* fileSystem.rename(`${root}/.git/HEAD.lock`, `${root}/.git/HEAD`)
})

const watchingOnDisk = Effect.fn('watchingOnDisk')(function* (...folders: readonly string[]) {
  const context = yield* Layer.build(
    Layer.provide(CheckoutHeads.layer, [Layer.provideMerge(FileWatch.layer, services), branches]),
  )
  const heads = Context.get(context, CheckoutHeads)

  yield* heads.follow(HashSet.fromIterable(folders))

  return heads
})

const watchingWith = Effect.fn('watchingWith')(function* (
  watchReady: FileWatch['Service']['watchReady'],
) {
  const context = yield* Layer.build(
    Layer.provide(CheckoutHeads.layer, [Layer.mock(FileWatch, { watchReady }), branches]),
  )

  return Context.get(context, CheckoutHeads)
})

layer(services, { excludeTestServices: true })('CheckoutHeads', (it) => {
  it.effect('says so when a switch renames a new HEAD into place', () =>
    Effect.gen(function* () {
      const root = yield* checkoutOn('main')
      const heads = yield* watchingOnDisk(root)

      expect(yield* awaitMove(heads)).toBe(true)

      yield* moveHead(root, branchHead('feature'))

      expect(yield* awaitMove(heads)).toBe(true)
    }),
  )

  it.effect('stays still for what git does beside HEAD, and for a HEAD on the same branch', () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const root = yield* checkoutOn('main')
      const heads = yield* watchingOnDisk(root)

      yield* awaitMove(heads)
      yield* fileSystem.writeFileString(`${root}/.git/index.lock`, '')
      yield* fileSystem.rename(`${root}/.git/index.lock`, `${root}/.git/index`)
      yield* fileSystem.writeFileString(`${root}/.git/HEAD.lock`, branchHead('feature'))
      yield* fileSystem.remove(`${root}/.git/HEAD.lock`)
      yield* moveHead(root, branchHead('main'))

      expect(yield* staysStill(heads)).toBe(true)
    }),
  )

  it.effect('stays still while a detached HEAD moves between commits', () =>
    Effect.gen(function* () {
      const root = yield* checkoutOn('main')
      const heads = yield* watchingOnDisk(root)

      yield* awaitMove(heads)
      yield* moveHead(root, 'b3f1c2d0e9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4\n')

      expect(yield* awaitMove(heads)).toBe(true)

      yield* moveHead(root, 'a2e2d48ec046b4df1a2e2d48ec046b4df1a2e2d4\n')

      expect(yield* staysStill(heads)).toBe(true)
    }),
  )

  it.effect('opens one watch per checkout, and closes the ones nothing sits in any more', () =>
    Effect.gen(function* () {
      const opened = yield* Queue.unbounded<string>()
      const closed = yield* Queue.unbounded<string>()
      const repo = yield* checkoutOn('main')
      const other = yield* checkoutOn('main')
      const heads = yield* watchingWith((target) =>
        Stream.unwrap(Effect.as(Queue.offer(opened, target), Stream.never)).pipe(
          Stream.ensuring(Queue.offer(closed, target)),
        ),
      )

      yield* heads.follow(HashSet.make(repo, `${repo}/packages/agent`, other))

      const firstTwo = [yield* Queue.take(opened), yield* Queue.take(opened)]

      yield* heads.follow(HashSet.make(other, `${other}/packages/agent`))

      const closedTarget = yield* Queue.take(closed)

      yield* heads.follow(HashSet.make(other))
      yield* heads.follow(HashSet.empty())

      const lastClosed = yield* Queue.take(closed)

      expect(firstTwo.toSorted()).toEqual([`${repo}/.git`, `${other}/.git`].toSorted())
      expect(closedTarget).toBe(`${repo}/.git`)
      expect(lastClosed).toBe(`${other}/.git`)
      expect(yield* Queue.size(opened)).toBe(0)
    }),
  )

  it.effect('reads HEAD only for an event that names it', () =>
    Effect.gen(function* () {
      const events = yield* Queue.unbounded<Option.Option<string>>()
      const reads = yield* Ref.make(0)
      const root = '/home/jliocsar/Projects/crook'
      const checkout = Option.some({ root, gitDirectory: `${root}/.git`, branch: Option.none() })
      const context = yield* Layer.build(
        Layer.provide(CheckoutHeads.layer, [
          Layer.mock(FileWatch, { watchReady: () => Stream.fromQueue(events) }),
          Layer.mock(GitBranches, {
            checkoutOf: () =>
              Effect.as(
                Ref.update(reads, (count) => count + 1),
                checkout,
              ),
          }),
        ]),
      )
      const heads = Context.get(context, CheckoutHeads)

      yield* heads.follow(HashSet.make(root))
      yield* Queue.offer(events, Option.none())
      yield* awaitMove(heads)

      const readsOnceReady = yield* Ref.get(reads)

      yield* Queue.offerAll(events, [Option.some('index.lock'), Option.some('HEAD.lock')])

      expect(yield* staysStill(heads)).toBe(true)
      expect(yield* Ref.get(reads)).toBe(readsOnceReady)

      yield* Queue.offer(events, Option.some('HEAD'))

      expect(yield* staysStill(heads)).toBe(true)
      expect(yield* Ref.get(reads)).toBe(readsOnceReady + 1)
    }),
  )

  it.effect('keeps watching after a watch fails', () =>
    Effect.gen(function* () {
      const root = yield* checkoutOn('main')
      const fileSystem = yield* FileSystem.FileSystem
      const attempts = yield* Ref.make(0)
      const heads = yield* watchingWith((target) =>
        Stream.unwrap(
          Effect.map(
            Ref.updateAndGet(attempts, (count) => count + 1),
            (attempt) =>
              attempt === 1
                ? Stream.die(new Error('inotify watch limit reached'))
                : fileSystem.watch(target).pipe(
                    Stream.map(() => Option.some('HEAD')),
                    Stream.prepend([Option.none()]),
                  ),
          ),
        ),
      )

      yield* heads.follow(HashSet.make(root))

      expect(yield* awaitMove(heads)).toBe(true)
      expect(yield* Ref.get(attempts)).toBe(2)
    }),
  )
})
