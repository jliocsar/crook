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

const keepOnlyFound = (exit: Exit.Exit<Option.Option<string>, GitMetadataUnreadable>) =>
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
      Effect.map(Option.some),
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

  const gitDirectoryIn = (directory: string) => {
    const entry = path.join(directory, GIT_ENTRY)

    return ifPresent(entry, fileSystem.stat(entry)).pipe(
      flatMapSome((info: FileSystem.File.Info) =>
        info.type === 'Directory'
          ? Effect.succeed(Option.some(entry))
          : pointedGitDirectory(directory, entry),
      ),
    )
  }

  const firstGitDirectory = (
    directories: readonly string[],
  ): Effect.Effect<Option.Option<string>, GitMetadataUnreadable> =>
    Arr.match(directories, {
      onEmpty: () => Effect.succeed(Option.none<string>()),
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

  const headAfterLookingAgain = (cwd: string) =>
    Cache.invalidate(gitDirectories, cwd).pipe(
      Effect.andThen(Cache.get(gitDirectories, cwd)),
      flatMapSome(headIn),
    )

  const branchOf = Effect.fn('GitBranches.branchOf')(function* (cwd: string) {
    if (!path.isAbsolute(cwd)) {
      return Option.none()
    }

    return yield* Cache.get(gitDirectories, cwd).pipe(
      flatMapSome((directory: string) =>
        headIn(directory).pipe(orElseSome(() => headAfterLookingAgain(cwd))),
      ),
      Effect.map(Option.flatMap(branchOfHead)),
    )
  })

  return GitBranches.of({ branchOf })
})

export class GitBranches extends Context.Service<
  GitBranches,
  {
    readonly branchOf: (cwd: string) => Effect.Effect<Option.Option<string>, GitMetadataUnreadable>
  }
>()('@crook/agent/GitBranches') {
  static readonly layer = Layer.effect(this, make)

  static readonly layerTest = (branches: ReadonlyMap<string, string>) =>
    Layer.succeed(
      this,
      GitBranches.of({
        branchOf: (cwd) => Effect.succeed(Option.fromNullishOr(branches.get(cwd))),
      }),
    )
}
