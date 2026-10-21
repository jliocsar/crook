import * as Arr from 'effect/Array'
import * as Config from 'effect/Config'
import * as Effect from 'effect/Effect'
import { pipe } from 'effect/Function'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as Schema from 'effect/Schema'

const ROOT_SEPARATOR = ','
const DEFAULT_ROOT = '.claude'

export class ClaudeRootNotAbsolute extends Schema.TaggedError<ClaudeRootNotAbsolute>()(
  'ClaudeRootNotAbsolute',
  { root: Schema.String },
) {
  override get message(): string {
    return `The Claude folder "${this.root}" (from CROOK_CLAUDE_ROOTS, CLAUDE_CONFIG_DIR or HOME) is not an absolute path, so crook would look for transcripts under whatever folder the agent started in. Nothing expands "~" in a service file: write the full path, such as /home/you/.claude-work.`
  }
}

export class ClaudeRootsEmpty extends Schema.TaggedError<ClaudeRootsEmpty>()(
  'ClaudeRootsEmpty',
  {},
) {
  override get message(): string {
    return 'CROOK_CLAUDE_ROOTS names no folder and CLAUDE_CONFIG_DIR is unset, so crook has no Claude folder to look for transcripts in and every chat would wait forever. Set CROOK_CLAUDE_ROOTS to a comma list of absolute paths, such as /home/you/.claude,/home/you/.claude-work, or unset it to use ~/.claude.'
  }
}

const listedRoots = (list: string) =>
  pipe(
    list.split(ROOT_SEPARATOR),
    Arr.map((root) => root.trim()),
    Arr.filter((root) => root.length > 0),
  )

export const ClaudeRootSettings = Config.all({
  listed: Config.option(Config.String('CROOK_CLAUDE_ROOTS')),
  configDirectory: Config.option(Config.NonEmptyString('CLAUDE_CONFIG_DIR')),
})

const rootsFrom = (path: Path.Path, listed: Option.Option<string>) =>
  Option.match(listed, {
    onNone: () => Effect.map(Config.String('HOME'), (home) => [path.join(home, DEFAULT_ROOT)]),
    onSome: (list) => Effect.succeed(listedRoots(list)),
  })

export const claudeRoots = Effect.gen(function* () {
  const path = yield* Path.Path
  const { listed, configDirectory } = yield* ClaudeRootSettings
  const roots = pipe(
    yield* rootsFrom(path, listed),
    Arr.appendAll(Option.toArray(configDirectory)),
    Arr.dedupe,
  )

  if (!Arr.isReadonlyArrayNonEmpty(roots)) {
    return yield* new ClaudeRootsEmpty()
  }

  return yield* Option.match(
    Arr.findFirst(roots, (root) => !path.isAbsolute(root)),
    {
      onNone: () => Effect.succeed(roots),
      onSome: (root) => Effect.fail(new ClaudeRootNotAbsolute({ root })),
    },
  )
})
