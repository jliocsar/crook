import * as Arr from 'effect/Array'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import { pipe } from 'effect/Function'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Order from 'effect/Order'
import * as Path from 'effect/Path'
import * as Record from 'effect/Record'
import * as Schema from 'effect/Schema'
import * as Str from 'effect/String'

import { claudeRoots } from '@crook/claude/ClaudeRoots'
import type { TranscriptFile } from '@crook/claude/TranscriptLocator'
import { SkillListing, type SkillScope } from '@crook/domain/Skill'

interface SkillSource {
  readonly scope: SkillScope
  readonly plugin: Option.Option<string>
}

interface Frontmatter {
  readonly fields: Readonly<Record<string, string>>
  readonly body: readonly string[]
}

interface InstalledPlugin {
  readonly installPath: string
  readonly projectPath?: string
}

const SKILL_FILE = 'SKILL.md'
const COMMAND_EXTENSION = '.md'
const FRONTMATTER_FENCE = '---'
const SYNCED_FOLDER = 'synced'
const SYNCED_PREFIX = 'anthropic-skills'
const PLUGIN_SEPARATOR = ':'
const PLUGIN_MARKETPLACE_SEPARATOR = '@'
const OVERRIDE_OFF = 'off'
const GIT_ENTRY = '.git'
const GITDIR_PREFIX = 'gitdir:'
const WORKTREE_GITDIR_MARKER = '/.git/worktrees/'
const PROJECT_FOLDER = '.claude'
const SKILLS_FOLDER = 'skills'
const COMMANDS_FOLDER = 'commands'
const NAME_FIELD = 'name'
const DESCRIPTION_FIELD = 'description'
const ARGUMENT_HINT_FIELD = 'argument-hint'
const USER_INVOCABLE_FIELD = 'user-invocable'
const LINE_BREAK = /\r?\n/u
const FIELD_KEY = /^[A-Za-z_][\w-]*$/u
const BLOCK_SCALAR = /^[|>][+-]?\d*$/u
const INDENTED = /^\s/u
const COMMAND_NAME = /^[^\s<>\p{C}]+(?: [^\s<>\p{C}]+)*$/u
const FALSE_WORDS = ['false', 'no', 'off', '0']

export const MANAGED_SKILL_HOMES = ['/etc/claude-code', '/Library/Application Support/ClaudeCode']

export class SkillsUnreadable extends Schema.TaggedError<SkillsUnreadable>()('SkillsUnreadable', {
  path: Schema.String,
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `Could not read the Claude skills or settings at ${this.path}, so the phone leaves them out of the / list. Check that crook runs as the same user as Claude and that the file is valid.`
  }
}

const SettingsFile = Schema.fromJsonString(
  Schema.Struct({
    enabledPlugins: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
    skillOverrides: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
  }),
)
type SettingsFile = typeof SettingsFile.Type

const InstalledPluginsFile = Schema.fromJsonString(
  Schema.Struct({
    plugins: Schema.Record(
      Schema.String,
      Schema.Array(
        Schema.Struct({
          installPath: Schema.String,
          projectPath: Schema.optionalKey(Schema.String),
        }),
      ),
    ),
  }),
)

type InstalledPluginsFile = typeof InstalledPluginsFile.Type

const decodeJsonString = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.String))

const BY_NAME = Order.mapInput(Order.String, (listing: SkillListing) => listing.name)
const EMPTY_SETTINGS: SettingsFile = {}

const isFence = (line: string) => line.trimEnd() === FRONTMATTER_FENCE

const isQuotedWith = (value: string, quote: string) =>
  value.length >= 2 && value.startsWith(quote) && value.endsWith(quote)

const unquoted = (value: string): string => {
  if (isQuotedWith(value, '"')) {
    return Option.getOrElse(decodeJsonString(value), () => value.slice(1, -1))
  }

  return isQuotedWith(value, "'") ? value.slice(1, -1).replaceAll("''", "'") : value
}

const fieldValue = (first: string, rest: readonly string[]): string => {
  const head = first.trim()
  const continued = pipe(
    rest,
    Arr.map((line) => line.trim()),
  )

  if (BLOCK_SCALAR.test(head)) {
    return continued.join(head.startsWith('|') ? '\n' : ' ').trim()
  }

  return unquoted(pipe([head, ...continued], Arr.filter(Str.isNonEmpty)).join(' '))
}

const fieldStart = (line: string, index: number) =>
  pipe(
    Option.liftPredicate(line.indexOf(':'), (colon) => colon > 0 && !INDENTED.test(line)),
    Option.filter((colon) => FIELD_KEY.test(line.slice(0, colon))),
    Option.map((colon) => ({ index, key: line.slice(0, colon), first: line.slice(colon + 1) })),
  )

const fieldsOf = (lines: readonly string[]): Readonly<Record<string, string>> => {
  const starts = pipe(lines, Arr.map(fieldStart), Arr.getSomes)

  return Record.fromEntries(
    Arr.map(starts, (start, position) => {
      const end = Option.match(Arr.get(starts, position + 1), {
        onNone: () => lines.length,
        onSome: (next) => next.index,
      })
      const rest = Arr.filter(lines.slice(start.index + 1, end), (line) => INDENTED.test(line))

      return [start.key, fieldValue(start.first, rest)] as const
    }),
  )
}

export const frontmatterOf = (text: string): Frontmatter => {
  const lines = text.split(LINE_BREAK)
  const plain: Frontmatter = { fields: {}, body: lines }

  if (!Option.exists(Arr.head(lines), isFence)) {
    return plain
  }

  return Option.match(pipe(lines, Arr.drop(1), Arr.findFirstIndex(isFence)), {
    onNone: () => plain,
    onSome: (end) => ({ fields: fieldsOf(lines.slice(1, end + 1)), body: lines.slice(end + 2) }),
  })
}

const isFalse = (value: string) => FALSE_WORDS.includes(value.trim().toLowerCase())

export const isCommandName = (name: string): boolean => COMMAND_NAME.test(name)

const field = (frontmatter: Frontmatter, key: string) =>
  pipe(Record.get(frontmatter.fields, key), Option.filter(Str.isNonEmpty))

const firstContentLine = (body: readonly string[]) =>
  pipe(
    body,
    Arr.map((line) => line.trim()),
    Arr.findFirst(Str.isNonEmpty),
  )

const withPlugin = (plugin: Option.Option<string>, name: string) =>
  Option.match(plugin, {
    onNone: () => name,
    onSome: (prefix) =>
      name.startsWith(`${prefix}${PLUGIN_SEPARATOR}`)
        ? name
        : `${prefix}${PLUGIN_SEPARATOR}${name}`,
  })

export const listingOf = (
  text: string,
  fallbackName: string,
  namedByField: boolean,
  source: SkillSource,
): Option.Option<SkillListing> => {
  const frontmatter = frontmatterOf(text)

  if (Option.exists(field(frontmatter, USER_INVOCABLE_FIELD), isFalse)) {
    return Option.none()
  }

  const ownName = pipe(
    field(frontmatter, NAME_FIELD),
    Option.filter((name) => namedByField && isCommandName(name)),
    Option.getOrElse(() => fallbackName),
  )

  return Option.some(
    new SkillListing({
      name: withPlugin(source.plugin, ownName),
      description: pipe(
        field(frontmatter, DESCRIPTION_FIELD),
        Option.orElse(() => firstContentLine(frontmatter.body)),
        Option.getOrElse(() => ''),
      ),
      argumentHint: field(frontmatter, ARGUMENT_HINT_FIELD),
      scope: source.scope,
    }),
  )
}

const isLoadableFolder = (source: SkillSource) => (name: string) => {
  const lowered = name.toLowerCase()

  return (
    lowered !== SYNCED_FOLDER &&
    (Option.isSome(source.plugin) || (!lowered.startsWith(SYNCED_PREFIX) && isCommandName(name)))
  )
}

const pluginNameOf = (key: string) => key.split(PLUGIN_MARKETPLACE_SEPARATOR)[0] ?? key

const enabledIn = (settings: readonly SettingsFile[]) =>
  pipe(
    settings,
    Arr.flatMap((file) => Record.toEntries(file.enabledPlugins ?? {})),
    Arr.reverse,
    Arr.dedupeWith(([left], [right]) => left === right),
    Arr.filter(([, enabled]) => enabled === true),
    Arr.map(([key]) => key),
  )

const hiddenIn = (settings: readonly SettingsFile[]) =>
  pipe(
    settings,
    Arr.flatMap((file) => Record.toEntries(file.skillOverrides ?? {})),
    Arr.reverse,
    Arr.dedupeWith(([left], [right]) => left === right),
    Arr.filter(([, state]) => state === OVERRIDE_OFF),
    Arr.map(([name]) => name),
  )

const installFor = (
  installs: readonly InstalledPlugin[],
  projectFolders: readonly string[],
): Option.Option<InstalledPlugin> =>
  Arr.findFirst(installs, (install) =>
    install.projectPath === undefined ? true : projectFolders.includes(install.projectPath),
  )

const makeFiles = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem
  const path = yield* Path.Path

  const warned = <Value, Failure>(
    effect: Effect.Effect<Value, Failure>,
    target: string,
    fallback: Value,
  ) =>
    effect.pipe(
      Effect.tapError((cause) =>
        Effect.logWarning(new SkillsUnreadable({ path: target, cause }).message),
      ),
      Effect.orElseSucceed(() => fallback),
    )

  const readOptional = (file: string) =>
    warned(
      fileSystem.readFileString(file).pipe(
        Effect.asSome,
        Effect.catchReason('PlatformError', 'NotFound', () =>
          Effect.succeed(Option.none<string>()),
        ),
      ),
      file,
      Option.none<string>(),
    )

  const listFolder = (folder: string, recursive: boolean) =>
    warned(
      fileSystem
        .readDirectory(folder, { recursive })
        .pipe(
          Effect.catchReason('PlatformError', 'NotFound', () =>
            Effect.succeed<readonly string[]>([]),
          ),
        ),
      folder,
      [],
    )

  const exists = (target: string) => warned(fileSystem.exists(target), target, false)

  const isFile = (target: string) =>
    warned(
      fileSystem.stat(target).pipe(
        Effect.map((info) => info.type === 'File'),
        Effect.catchReason('PlatformError', 'NotFound', () => Effect.succeed(false)),
      ),
      target,
      false,
    )

  const readSettings = (file: string) =>
    Effect.flatMap(
      readOptional(file),
      Option.match({
        onNone: () => Effect.succeed(EMPTY_SETTINGS),
        onSome: (text) => warned(Schema.decodeEffect(SettingsFile)(text), file, EMPTY_SETTINGS),
      }),
    )

  const readInstalledPlugins = (file: string) =>
    Effect.flatMap(
      readOptional(file),
      Option.match({
        onNone: () => Effect.succeed<InstalledPluginsFile['plugins']>({}),
        onSome: (text) =>
          warned(
            Effect.map(
              Schema.decodeEffect(InstalledPluginsFile)(text),
              (decoded) => decoded.plugins,
            ),
            file,
            {},
          ),
      }),
    )

  const readSkillFolder = Effect.fn('SkillCatalog.readSkillFolder')(function* (
    folder: string,
    source: SkillSource,
  ) {
    const names = Arr.filter(yield* listFolder(folder, false), isLoadableFolder(source))
    const listings = yield* Effect.forEach(
      names,
      (name) =>
        Effect.map(readOptional(path.join(folder, name, SKILL_FILE)), (text) =>
          Option.flatMap(text, (content) => listingOf(content, name, true, source)),
        ),
      { concurrency: 'unbounded' },
    )

    return Arr.getSomes(listings)
  })

  const commandNameOf = (relative: string) =>
    relative.slice(0, -COMMAND_EXTENSION.length).split(path.sep).join(PLUGIN_SEPARATOR)

  const readCommandFolder = Effect.fn('SkillCatalog.readCommandFolder')(function* (
    folder: string,
    source: SkillSource,
  ) {
    const files = pipe(
      yield* listFolder(folder, true),
      Arr.filter((relative) => relative.endsWith(COMMAND_EXTENSION)),
      Arr.filter((relative) => isLoadableFolder(source)(commandNameOf(relative))),
    )
    const listings = yield* Effect.forEach(
      files,
      (relative) =>
        Effect.map(readOptional(path.join(folder, relative)), (text) =>
          Option.flatMap(text, (content) =>
            listingOf(content, commandNameOf(relative), false, source),
          ),
        ),
      { concurrency: 'unbounded' },
    )

    return Arr.getSomes(listings)
  })

  return {
    path,
    readOptional,
    exists,
    isFile,
    readSettings,
    readInstalledPlugins,
    readSkillFolder,
    readCommandFolder,
  }
})

type CatalogFiles = Effect.Success<typeof makeFiles>

const ancestorsOf = (path: Path.Path, folder: string): readonly string[] =>
  Arr.unfold(Option.some(folder), (current) =>
    Option.map(current, (at) => {
      const parent = path.dirname(at)

      return [at, parent === at ? Option.none() : Option.some(parent)] as const
    }),
  )

const makeProjects = (files: CatalogFiles) => {
  const { path } = files

  const projectFoldersOf = Effect.fn('SkillCatalog.projectFoldersOf')(function* (cwd: string) {
    if (!path.isAbsolute(cwd)) {
      return []
    }

    const ancestors = ancestorsOf(path, path.resolve(cwd))
    const checkouts = yield* Effect.forEach(
      ancestors,
      (folder) => files.exists(path.join(folder, GIT_ENTRY)),
      { concurrency: 'unbounded' },
    )

    return Option.match(
      Arr.findFirstIndex(checkouts, (isCheckout) => isCheckout),
      {
        onNone: () => [path.resolve(cwd)],
        onSome: (index) => Arr.reverse(ancestors.slice(0, index + 1)),
      },
    )
  })

  const mainCheckoutOf = Effect.fn('SkillCatalog.mainCheckoutOf')(function* (checkout: string) {
    const gitEntry = path.join(checkout, GIT_ENTRY)
    const gitFile = (yield* files.isFile(gitEntry))
      ? yield* files.readOptional(gitEntry)
      : Option.none<string>()

    return pipe(
      gitFile,
      Option.map((content) => content.trim()),
      Option.filter((content) => content.startsWith(GITDIR_PREFIX)),
      Option.map((content) => content.slice(GITDIR_PREFIX.length).trim()),
      Option.flatMap((gitDirectory) =>
        pipe(
          Option.liftPredicate(gitDirectory.indexOf(WORKTREE_GITDIR_MARKER), (at) => at > 0),
          Option.map((at) => gitDirectory.slice(0, at)),
        ),
      ),
    )
  })

  const projectSkillFoldersOf = Effect.fn('SkillCatalog.projectSkillFoldersOf')(function* (
    projectFolders: readonly string[],
  ) {
    const skillFolders = Arr.map(projectFolders, (folder) =>
      path.join(folder, PROJECT_FOLDER, SKILLS_FOLDER),
    )
    const checkout = Arr.head(projectFolders)

    if (
      Option.isNone(checkout) ||
      (yield* files.exists(path.join(checkout.value, PROJECT_FOLDER, SKILLS_FOLDER)))
    ) {
      return skillFolders
    }

    return Option.match(yield* mainCheckoutOf(checkout.value), {
      onNone: () => skillFolders,
      onSome: (main) => [path.join(main, PROJECT_FOLDER, SKILLS_FOLDER), ...skillFolders],
    })
  })

  return { projectFoldersOf, projectSkillFoldersOf }
}

const makePlugins = (files: CatalogFiles) =>
  Effect.fn('SkillCatalog.readPlugins')(function* (
    personalRoots: readonly string[],
    settings: readonly SettingsFile[],
    projectFolders: readonly string[],
  ) {
    const { path } = files
    const installed = yield* Effect.forEach(personalRoots, (root) =>
      files.readInstalledPlugins(path.join(root, 'plugins', 'installed_plugins.json')),
    )
    const installs = pipe(
      enabledIn(settings),
      Arr.flatMap((key) =>
        pipe(
          installed,
          Arr.findFirst((plugins) => Record.has(plugins, key)),
          Option.flatMap((plugins) => Record.get(plugins, key)),
          Option.flatMap((entries) => installFor(entries, projectFolders)),
          Option.map((install) => ({ plugin: pluginNameOf(key), install })),
          Option.toArray,
        ),
      ),
    )
    const listings = yield* Effect.forEach(
      installs,
      ({ plugin, install }) => {
        const source: SkillSource = { scope: 'plugin', plugin: Option.some(plugin) }

        return Effect.zipWith(
          files.readSkillFolder(path.join(install.installPath, SKILLS_FOLDER), source),
          files.readCommandFolder(path.join(install.installPath, COMMANDS_FOLDER), source),
          (skills, commands) => Arr.appendAll(skills, commands),
          { concurrent: true },
        )
      },
      { concurrency: 'unbounded' },
    )

    return Arr.flatten(listings)
  })

const make = (roots: readonly string[], managedHomes: readonly string[]) =>
  Effect.gen(function* () {
    const files = yield* makeFiles
    const { path } = files
    const projects = makeProjects(files)
    const readPlugins = makePlugins(files)
    const personal: SkillSource = { scope: 'personal', plugin: Option.none() }
    const project: SkillSource = { scope: 'project', plugin: Option.none() }

    const settingsFiles = (personalRoots: readonly string[], projectFolders: readonly string[]) => [
      ...Arr.map(personalRoots, (root) => path.join(root, 'settings.json')),
      ...pipe(
        Arr.head(projectFolders),
        Option.toArray,
        Arr.flatMap((checkout) => [
          path.join(checkout, PROJECT_FOLDER, 'settings.json'),
          path.join(checkout, PROJECT_FOLDER, 'settings.local.json'),
        ]),
      ),
    ]

    const list = Effect.fn('SkillCatalog.list')(function* (
      cwd: string,
      transcript: Option.Option<TranscriptFile>,
    ) {
      const personalRoots = Option.match(transcript, {
        onNone: () => roots,
        onSome: (file) => [path.dirname(path.dirname(path.dirname(file.path)))],
      })
      const projectFolders = yield* projects.projectFoldersOf(cwd)
      const settings = yield* Effect.forEach(
        settingsFiles(personalRoots, projectFolders),
        files.readSettings,
        { concurrency: 'unbounded' },
      )
      const projectSkillFolders = yield* projects.projectSkillFoldersOf(projectFolders)
      const local = yield* Effect.all(
        [
          ...Arr.map(managedHomes, (home) =>
            files.readSkillFolder(path.join(home, PROJECT_FOLDER, SKILLS_FOLDER), personal),
          ),
          ...Arr.map(personalRoots, (root) =>
            files.readSkillFolder(path.join(root, SKILLS_FOLDER), personal),
          ),
          ...Arr.map(projectSkillFolders, (folder) => files.readSkillFolder(folder, project)),
          ...Arr.map(personalRoots, (root) =>
            files.readCommandFolder(path.join(root, COMMANDS_FOLDER), personal),
          ),
          ...Arr.map(projectFolders, (folder) =>
            files.readCommandFolder(path.join(folder, PROJECT_FOLDER, COMMANDS_FOLDER), project),
          ),
        ],
        { concurrency: 'unbounded' },
      )
      const hidden = hiddenIn(settings)
      const plugins = yield* readPlugins(personalRoots, settings, projectFolders)

      return pipe(
        Arr.flatten(local),
        Arr.dedupeWith((left, right) => left.name === right.name),
        Arr.filter((listing) => !hidden.includes(listing.name)),
        Arr.appendAll(plugins),
        Arr.dedupeWith((left, right) => left.name === right.name),
        Arr.sort(BY_NAME),
      )
    })

    return SkillCatalog.of({ list })
  })

export class SkillCatalog extends Context.Service<
  SkillCatalog,
  {
    readonly list: (
      cwd: string,
      transcript: Option.Option<TranscriptFile>,
    ) => Effect.Effect<readonly SkillListing[]>
  }
>()('@crook/claude/SkillCatalog') {
  static readonly layerAt = (roots: readonly string[], managedHomes: readonly string[]) =>
    Layer.effect(this, make(roots, managedHomes))

  static readonly layer = Layer.unwrap(
    Effect.map(claudeRoots, (roots) => this.layerAt(roots, MANAGED_SKILL_HOMES)),
  )
}
