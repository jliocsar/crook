import * as Arr from 'effect/Array'
import { pipe } from 'effect/Function'
import * as Option from 'effect/Option'
import * as Order from 'effect/Order'

import { SkillListing, type SkillScope } from '@crook/domain/Skill'

export interface SlashGroup {
  readonly scope: SkillScope
  readonly label: string
  readonly commands: readonly SkillListing[]
}

const SLASH_ONLY = /^\/\S*$/u
const PLUGIN_SEPARATOR = ':'
const SCOPE_ORDER: readonly SkillScope[] = ['project', 'personal', 'plugin', 'builtin']

const SCOPE_LABELS = {
  project: 'This project',
  personal: 'Yours',
  plugin: 'Plugins',
  builtin: 'Claude Code',
} satisfies Record<SkillScope, string>

const builtIn = (name: string, description: string, argumentHint: string) =>
  new SkillListing({
    name,
    description,
    argumentHint: Option.liftPredicate(argumentHint, (hint) => hint !== ''),
    scope: 'builtin',
  })

export const PTY_BUILT_INS: readonly SkillListing[] = [
  builtIn('compact', 'Free up context by summarizing the conversation so far', '[instructions]'),
  builtIn('clear', 'Start a new conversation with empty context', '[name]'),
  builtIn('model', 'Switch the model, and keep it for new sessions', '[model]'),
  builtIn('effort', 'Set the effort level', '[level|auto|status]'),
  builtIn('fast', 'Turn fast mode on or off', '[on|off]'),
  builtIn('rename', 'Rename the session', '[name]'),
  builtIn('cost', 'Show the session cost, plan limits and activity', ''),
]

const BY_NAME = Order.mapInput(Order.String, (listing: SkillListing) => listing.name)

const startsWithQuery = (name: string, query: string) => {
  const lowered = name.toLowerCase()

  return (
    lowered.startsWith(query) ||
    pipe(
      lowered.split(PLUGIN_SEPARATOR),
      Arr.drop(1),
      Arr.some((part) => part.startsWith(query)),
    )
  )
}

export const offeredCommands = (skills: readonly SkillListing[]): readonly SkillListing[] =>
  pipe(
    PTY_BUILT_INS,
    Arr.filter((builtin) => !Arr.some(skills, (skill) => skill.name === builtin.name)),
    Arr.prependAll(skills),
  )

export const slashSuggestions = (
  text: string,
  skills: readonly SkillListing[],
): readonly SlashGroup[] => {
  if (!SLASH_ONLY.test(text)) {
    return []
  }

  const query = text.slice(1).toLowerCase()
  const matching = Arr.filter(offeredCommands(skills), (command) =>
    startsWithQuery(command.name, query),
  )

  return pipe(
    SCOPE_ORDER,
    Arr.map((scope): SlashGroup => ({
      scope,
      label: SCOPE_LABELS[scope],
      commands: pipe(
        matching,
        Arr.filter((command) => command.scope === scope),
        Arr.sort(BY_NAME),
      ),
    })),
    Arr.filter((group) => Arr.isReadonlyArrayNonEmpty(group.commands)),
  )
}
