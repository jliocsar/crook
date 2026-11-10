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
const COMMAND_SEND = /^(?:\/[A-Za-z][\w:.-]*(?:\s|$)|!)/u
const COMMAND_NAME = /^\/([^\s/]+)(\s*)/u
const PLUGIN_SEPARATOR = ':'
const SCOPE_ORDER: readonly SkillScope[] = ['project', 'personal', 'plugin', 'builtin']

const SCOPE_LABELS = {
  project: 'This project',
  personal: 'Yours',
  plugin: 'Plugins',
  builtin: 'Claude Code',
} satisfies Record<SkillScope, string>

const OPENS_A_DIALOG_BARE = new Map([
  ['add-dir', ''],
  ['bashes', ''],
  ['config', ''],
  ['cost', ''],
  ['effort', ' Name a level instead, like /effort high.'],
  ['export', ''],
  ['fast', ' Say which instead, like /fast on.'],
  ['feedback', ''],
  ['help', ''],
  ['hooks', ''],
  ['mcp', ''],
  ['memory', ''],
  ['model', ''],
  ['permissions', ''],
  ['plugin', ''],
  ['privacy-settings', ''],
  ['release-notes', ''],
  ['resume', ' Name a session instead, with its id.'],
  ['rewind', ''],
  ['sandbox', ''],
  ['stats', ''],
  ['status', ''],
  ['tasks', ''],
  ['theme', ''],
  ['usage', ''],
])

const OPENS_A_DIALOG_WITH_ARGUMENTS = new Set(['theme'])

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

export const isCommandSend = (text: string): boolean => COMMAND_SEND.test(text)

export const noAnswerNote = (text: string): string =>
  `No answer to ${text} yet. It may have opened a dialog on the laptop, which would take your next message.`

export const laptopOnlyNote = (
  text: string,
  skills: readonly SkillListing[],
): Option.Option<string> =>
  pipe(
    Option.fromNullishOr(COMMAND_NAME.exec(text)),
    Option.flatMap(([whole, name = '']) =>
      pipe(
        Option.fromUndefinedOr(OPENS_A_DIALOG_BARE.get(name)),
        Option.filter(() => whole === text || OPENS_A_DIALOG_WITH_ARGUMENTS.has(name)),
        Option.filter(() => !Arr.some(skills, (skill) => skill.name === name)),
        Option.map((hint) => `/${name} opens a dialog, so it needs the laptop.${hint}`),
      ),
    ),
  )

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
