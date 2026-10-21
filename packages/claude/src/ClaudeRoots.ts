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

const listedRoots = (list: string) =>
  pipe(
    list.split(ROOT_SEPARATOR),
    Arr.map((root) => root.trim()),
    Arr.filter((root) => root.length > 0),
  )

const ClaudeRootSettings = Config.all({
  listed: Config.option(Config.String('CROOK_CLAUDE_ROOTS')),
  configDirectory: Config.option(Config.NonEmptyString('CLAUDE_CONFIG_DIR')),
  home: Config.String('HOME'),
})

export const claudeRoots = Effect.gen(function* () {
  const path = yield* Path.Path
  const { listed, configDirectory, home } = yield* ClaudeRootSettings
  const roots = pipe(
    Option.match(listed, {
      onNone: () => [path.join(home, DEFAULT_ROOT)],
      onSome: listedRoots,
    }),
    Arr.appendAll(Option.toArray(configDirectory)),
    Arr.dedupe,
  )

  return yield* Option.match(
    Arr.findFirst(roots, (root) => !path.isAbsolute(root)),
    {
      onNone: () => Effect.succeed(roots),
      onSome: (root) => Effect.fail(new ClaudeRootNotAbsolute({ root })),
    },
  )
})
