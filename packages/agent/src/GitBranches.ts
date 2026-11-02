import * as Arr from 'effect/Array'
import * as Cache from 'effect/Cache'
import * as Context from 'effect/Context'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import type { PlatformError } from 'effect/PlatformError'
import * as Schema from 'effect/Schema'
import * as Str from 'effect/String'

import { flatMapSome, orElseSome } from '@crook/agent/OptionEffect'

export interface GitCheckout {
  readonly root: string
  readonly branch: Option.Option<string>
}

interface FoundGitDirectory {
  readonly root: string
  readonly gitDirectory: string
}

const GIT_ENTRY = '.git'
const HEAD_FILE = 'HEAD'
const GITDIR_PREFIX = 'gitdir: '
const BRANCH_REF_PREFIX = 'ref: refs/heads/'

export class GitMetadataUnreadable extends Schema.TaggedError<GitMetadataUnreadable>()(
  'GitMetadataUnreadable',
  { path: Schema.String, cause: Schema.Defect() },
) {
  override get message(): string {
    return `Could not read ${this.path} while looking up the git branch of an agent's folder. Check that crook runs as the same user as the agent and can read its checkout.`
  }
}

const afterPrefix = (prefix: string) => (text: string) =>
  Option.liftPredicate(text.trim(), (line) => line.startsWith(prefix)).pipe(
    Option.map((line) => line.slice(prefix.length)),
    Option.filter(Str.isNonEmpty),
  )

const branchOfHead = afterPrefix(BRANCH_REF_PREFIX)

const keepOnlyFound = (exit: Exit.Exit<Option.Option<FoundGitDirectory>, GitMetadataUnreadable>) =>
  Exit.match(exit, {
    onSuccess: (found) => (Option.isSome(found) ? Duration.infinity : Duration.zero),
    onFailure: () => Duration.zero,
  })

const ancestorsOf = (path: Path.Path, directory: string) =>
  Arr.unfold(Option.some(directory), (current) =>
    Option.map(current, (here) => {
      const parent = path.dirname(here)

      return [here, Option.liftPredicate(parent, (above) => above !== here)] as const
    }),
  )

const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem
  const path = yield* Path.Path

  const ifPresent = <Success>(target: string, read: Effect.Effect<Success, PlatformError>) =>
    read.pipe(
      Effect.asSome,
      Effect.catchReason('PlatformError', 'NotFound', () => Effect.succeedNone),
      Effect.mapError((cause) => new GitMetadataUnreadable({ path: target, cause })),
    )

  const pointedGitDirectory = (directory: string, entry: string) =>
    ifPresent(entry, fileSystem.readFileString(entry)).pipe(
      Effect.map((pointer) =>
        Option.flatMap(pointer, afterPrefix(GITDIR_PREFIX)).pipe(
          Option.map((gitDirectory) => path.resolve(directory, gitDirectory)),
        ),
      ),
    )

  const gitDirectoryIn = (
    directory: string,
  ): Effect.Effect<Option.Option<FoundGitDirectory>, GitMetadataUnreadable> => {
    const entry = path.join(directory, GIT_ENTRY)
    const foundIn = (gitDirectory: string): FoundGitDirectory => ({ root: directory, gitDirectory })

    return ifPresent(entry, fileSystem.stat(entry)).pipe(
      flatMapSome(
        (
          info: FileSystem.File.Info,
        ): Effect.Effect<Option.Option<string>, GitMetadataUnreadable> =>
          info.type === 'Directory'
            ? Effect.succeedSome(entry)
            : pointedGitDirectory(directory, entry),
      ),
      Effect.map(Option.map(foundIn)),
    )
  }

  const firstGitDirectory = (
    directories: readonly string[],
  ): Effect.Effect<Option.Option<FoundGitDirectory>, GitMetadataUnreadable> =>
    Arr.match(directories, {
      onEmpty: () => Effect.succeed(Option.none<FoundGitDirectory>()),
      onNonEmpty: ([directory, ...above]) =>
        gitDirectoryIn(directory).pipe(orElseSome(() => firstGitDirectory(above))),
    })

  const gitDirectories = yield* Cache.makeWith(
    (cwd: string) => firstGitDirectory(ancestorsOf(path, cwd)),
    { capacity: Number.POSITIVE_INFINITY, timeToLive: keepOnlyFound },
  )

  const headIn = (directory: string) => {
    const head = path.join(directory, HEAD_FILE)

    return ifPresent(head, fileSystem.readFileString(head))
  }

  const checkoutIn = (
    found: FoundGitDirectory,
  ): Effect.Effect<Option.Option<GitCheckout>, GitMetadataUnreadable> => {
    const checkoutAt = (head: string): GitCheckout => ({
      root: found.root,
      branch: branchOfHead(head),
    })

    return headIn(found.gitDirectory).pipe(Effect.map(Option.map(checkoutAt)))
  }

  const checkoutAfterLookingAgain = (cwd: string) =>
    Cache.refresh(gitDirectories, cwd).pipe(flatMapSome(checkoutIn))

  const checkoutOf = Effect.fn('GitBranches.checkoutOf')(function* (cwd: string) {
    if (!path.isAbsolute(cwd)) {
      return Option.none<GitCheckout>()
    }

    return yield* Cache.get(gitDirectories, cwd).pipe(
      flatMapSome((found: FoundGitDirectory) =>
        checkoutIn(found).pipe(orElseSome(() => checkoutAfterLookingAgain(cwd))),
      ),
    )
  })

  return GitBranches.of({ checkoutOf })
})

export class GitBranches extends Context.Service<
  GitBranches,
  {
    readonly checkoutOf: (
      cwd: string,
    ) => Effect.Effect<Option.Option<GitCheckout>, GitMetadataUnreadable>
  }
>()('@crook/agent/GitBranches') {
  static readonly layer = Layer.effect(this, make)

  static readonly layerTest = (branches: ReadonlyMap<string, string>) =>
    Layer.succeed(
      this,
      GitBranches.of({
        checkoutOf: (cwd) =>
          Effect.succeed(
            Option.map(Option.fromNullishOr(branches.get(cwd)), (branch): GitCheckout => ({
              root: cwd,
              branch: Option.some(branch),
            })),
          ),
      }),
    )
}
