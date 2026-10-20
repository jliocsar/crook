import * as Arr from 'effect/Array'
import * as Config from 'effect/Config'
import { pipe } from 'effect/Function'
import * as Option from 'effect/Option'

const ROOT_SEPARATOR = ','
const DEFAULT_ROOT = '.claude'

const listedRoots = (list: string) =>
  pipe(
    list.split(ROOT_SEPARATOR),
    Arr.map((root) => root.trim()),
    Arr.filter((root) => root.length > 0),
  )

export const ClaudeRoots = Config.all({
  listed: Config.option(Config.String('CROOK_CLAUDE_ROOTS')),
  configDirectory: Config.option(Config.NonEmptyString('CLAUDE_CONFIG_DIR')),
  home: Config.String('HOME'),
}).pipe(
  Config.map(({ listed, configDirectory, home }) =>
    pipe(
      Option.match(listed, {
        onNone: () => [`${home}/${DEFAULT_ROOT}`],
        onSome: listedRoots,
      }),
      Arr.appendAll(Option.toArray(configDirectory)),
      Arr.dedupe,
    ),
  ),
)
