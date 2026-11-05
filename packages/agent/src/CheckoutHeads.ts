import * as Arr from 'effect/Array'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as FiberMap from 'effect/FiberMap'
import { pipe } from 'effect/Function'
import * as HashMap from 'effect/HashMap'
import type * as HashSet from 'effect/HashSet'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Queue from 'effect/Queue'
import * as Stream from 'effect/Stream'

import { type GitCheckout, GitBranches, HEAD_FILE } from '@crook/agent/GitBranches'
import { keepWatching } from '@crook/agent/KeepWatching'
import { FileWatch, readyOr } from '@crook/claude/FileWatch'

type FollowFolders = (folders: HashSet.HashSet<string>) => Effect.Effect<void>

const make = Effect.gen(function* () {
  const gitBranches = yield* GitBranches
  const watch = yield* FileWatch
  const moved = yield* Queue.sliding<void>(1)
  const watching = yield* FiberMap.make<string>()

  const followHead = ({ root, gitDirectory }: GitCheckout) =>
    watch.watchReady(gitDirectory).pipe(
      Stream.filter(readyOr((name) => name === HEAD_FILE)),
      Stream.mapEffect(() => gitBranches.checkoutOf(root)),
      Stream.map(Option.flatMap((checkout) => checkout.branch)),
      Stream.changes,
      Stream.runForEach(() => Queue.offer(moved, undefined)),
      keepWatching(gitDirectory),
    )

  const checkoutOf = (folder: string) =>
    gitBranches
      .checkoutOf(folder)
      .pipe(
        Effect.catchTag('GitMetadataUnreadable', (error) =>
          Effect.as(Effect.logWarning(error.message), Option.none<GitCheckout>()),
        ),
      )

  const follow = Effect.fn('CheckoutHeads.follow')(function* (folders: HashSet.HashSet<string>) {
    const found = yield* Effect.forEach(folders, checkoutOf, { concurrency: 'unbounded' })
    const wanted = pipe(
      Arr.getSomes(found),
      Arr.map((checkout) => [checkout.gitDirectory, checkout] as const),
      HashMap.fromIterable,
    )
    const stale = pipe(
      Arr.fromIterable(watching),
      Arr.map(([gitDirectory]) => gitDirectory),
      Arr.filter((gitDirectory) => !HashMap.has(wanted, gitDirectory)),
    )

    yield* Effect.forEach(stale, (gitDirectory) => FiberMap.remove(watching, gitDirectory), {
      discard: true,
    })
    yield* Effect.forEach(
      wanted,
      ([gitDirectory, checkout]) =>
        FiberMap.run(watching, gitDirectory, followHead(checkout), { onlyIfMissing: true }),
      { discard: true },
    )
  })

  return CheckoutHeads.of({ changes: Stream.fromQueue(moved), follow })
})

export class CheckoutHeads extends Context.Service<
  CheckoutHeads,
  {
    readonly changes: Stream.Stream<void>
    readonly follow: FollowFolders
  }
>()('@crook/agent/CheckoutHeads') {
  static readonly layer = Layer.effect(this, make)

  static readonly layerTest = (
    changes: Stream.Stream<void> = Stream.never,
    follow: FollowFolders = () => Effect.void,
  ) => Layer.succeed(this, CheckoutHeads.of({ changes, follow }))
}
