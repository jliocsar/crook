import * as Arr from 'effect/Array'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as HashMap from 'effect/HashMap'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import type { PlatformError } from 'effect/PlatformError'
import * as Ref from 'effect/Ref'
import * as Schema from 'effect/Schema'

import { flatMapSome, orElseSome } from '@crook/agent/OptionEffect'

const GIT_ENTRY = '.git'
const HEAD_FILE = 'HEAD'
const GITDIR_PREFIX = 'gitdir: '
const BRANCH_REF_PREFIX = 'ref: refs/heads/'

export class GitHeadUnreadable extends Schema.TaggedError<GitHeadUnreadable>()(
  'GitHeadUnreadable',
  { path: Schema.String, cause: Schema.Defect() },
) {
  override get message(): string {
    return `Could not read ${this.path} while looking up the git branch of an agent's folder. Check that crook runs as the same user as the agent and can read its checkout.`
  }
}

const nonEmpty = (text: string) => text.length > 0

const afterPrefix = (prefix: string) => (text: string) =>
  Option.liftPredicate(text.trim(), (line) => line.startsWith(prefix)).pipe(
    Option.map((line) => line.slice(prefix.length)),
    Option.filter(nonEmpty),
  )

const branchOfHead = afterPrefix(BRANCH_REF_PREFIX)

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
  const gitDirectories = yield* Ref.make(HashMap.empty<string, Option.Option<string>>())

  const ifPresent = <Success>(target: string, read: Effect.Effect<Success, PlatformError>) =>
    read.pipe(
      Effect.map(Option.some),
      Effect.catchReason('PlatformError', 'NotFound', () => Effect.succeedNone),
      Effect.mapError((cause) => new GitHeadUnreadable({ path: target, cause })),
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
  ): Effect.Effect<Option.Option<string>, GitHeadUnreadable> =>
    Arr.match(directories, {
      onEmpty: () => Effect.succeed(Option.none<string>()),
      onNonEmpty: ([directory, ...above]) =>
        gitDirectoryIn(directory).pipe(orElseSome(() => firstGitDirectory(above))),
    })

  const gitDirectoryOf = (cwd: string) =>
    Ref.get(gitDirectories).pipe(
      Effect.map(HashMap.get(cwd)),
      Effect.flatMap(
        Option.match({
          onSome: (cached) => Effect.succeed(cached),
          onNone: () =>
            firstGitDirectory(ancestorsOf(path, cwd)).pipe(
              Effect.tap((found) => Ref.update(gitDirectories, HashMap.set(cwd, found))),
            ),
        }),
      ),
    )

  const branchOf = Effect.fn('GitBranches.branchOf')(function* (cwd: string) {
    if (!path.isAbsolute(cwd)) {
      return Option.none()
    }

    return yield* gitDirectoryOf(cwd).pipe(
      flatMapSome((directory: string) => {
        const head = path.join(directory, HEAD_FILE)

        return ifPresent(head, fileSystem.readFileString(head))
      }),
      Effect.map(Option.flatMap(branchOfHead)),
    )
  })

  return GitBranches.of({ branchOf })
})

export class GitBranches extends Context.Service<
  GitBranches,
  {
    readonly branchOf: (cwd: string) => Effect.Effect<Option.Option<string>, GitHeadUnreadable>
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
