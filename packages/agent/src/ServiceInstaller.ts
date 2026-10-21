import * as Arr from 'effect/Array'
import * as Config from 'effect/Config'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import { pipe } from 'effect/Function'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import type { PlatformError } from 'effect/PlatformError'
import * as Redacted from 'effect/Redacted'
import * as Result from 'effect/Result'
import * as Schema from 'effect/Schema'

import { CrookAuditLogPath, CrookAuditPolicy } from '@crook/agent/AuditLog'
import { hooksBlock } from '@crook/agent/ClaudeHookSettings'
import { CrookCreatedPanesPath } from '@crook/agent/CreatedPanes'
import { CrookHookSocketPath } from '@crook/agent/HookInbox'
import { CrookHubToken, CrookHubUrl, CrookMachineLabel } from '@crook/agent/HubLink'
import { CrookMachineId } from '@crook/agent/MachineStateSync'
import { CrookRecentPlacesPath } from '@crook/agent/RecentPlaces'
import {
  type EnvironmentEntry,
  LAUNCHD_LABEL,
  SYSTEMD_UNIT_NAME,
  environmentFileContents,
  launchdPlist,
  shellCommand,
  shellWord,
  systemdUnit,
} from '@crook/agent/ServiceDefinition'
import { ServiceManager, launchctl, systemctl } from '@crook/agent/ServiceManager'
import {
  OWNER_ONLY_FILE_MODE,
  type WriteAtomicallyOptions,
  makeWriteAtomically,
  xdgHome,
} from '@crook/agent/StateDirectory'
import { claudeRoots } from '@crook/claude/ClaudeRoots'
import { HerdrSocketPath } from '@crook/herdr/HerdrClient'

export type ServiceTarget = Systemd | Launchd

export type ServiceLogs = Journal | LogFile

const ENVIRONMENT_FILE_NAME = 'agent.env'
const CLAUDE_SETTINGS_FILE_NAME = 'settings.json'
const HOOK_SUBCOMMAND = 'hook'
const LINUX = 'linux'
const MACOS = 'darwin'

const CARRIED_VARIABLES = [
  'HERDR_SOCKET_PATH',
  'CROOK_CLAUDE_ROOTS',
  'CLAUDE_CONFIG_DIR',
  'XDG_STATE_HOME',
  'CROOK_AUDIT_LOG_PATH',
  'CROOK_AUDIT_ARGUMENT_LIMIT',
  'CROOK_AUDIT_REDACT',
  'CROOK_CREATED_PANES_PATH',
  'CROOK_RECENT_PLACES_PATH',
] as const

const ServicePaths = Schema.Struct({
  definitionFile: Schema.String,
  environmentFile: Schema.String,
})

type ServicePaths = typeof ServicePaths.Type

export class Systemd extends Schema.TaggedClass<Systemd>()('Systemd', {}) {}

export class Launchd extends Schema.TaggedClass<Launchd>()('Launchd', { userId: Schema.Int }) {}

export class Journal extends Schema.TaggedClass<Journal>()('Journal', {}) {}

export class LogFile extends Schema.TaggedClass<LogFile>()('LogFile', { file: Schema.String }) {}

export class ServicePlatformUnsupported extends Schema.TaggedError<ServicePlatformUnsupported>()(
  'ServicePlatformUnsupported',
  { platform: Schema.String },
) {
  override get message(): string {
    return `crook-agent installs a systemd user unit on Linux and a launchd agent on macOS, and this machine runs ${this.platform}. Keep "crook-agent run" running under your own supervisor instead.`
  }
}

export class ServiceSettingsUnreadable extends Schema.TaggedError<ServiceSettingsUnreadable>()(
  'ServiceSettingsUnreadable',
  { detail: Schema.String },
) {
  override get message(): string {
    return `install-service reads the agent's settings from its own environment and could not: ${this.detail}. Set or correct that variable and run it again, as CROOK_HUB_URL=<hub address> CROOK_HUB_TOKEN=<this machine's exe.dev token> CROOK_MACHINE_ID=<machine id> crook-agent install-service; nothing was written.`
  }
}

export class ServiceFileUnwritable extends Schema.TaggedError<ServiceFileUnwritable>()(
  'ServiceFileUnwritable',
  { path: Schema.String, detail: Schema.String },
) {
  override get message(): string {
    return `Could not change ${this.path}: ${this.detail}. Check the permissions of that folder and run the same crook-agent command again.`
  }
}

export class InstalledService extends Schema.Class<InstalledService>('InstalledService')({
  target: Schema.Union([Systemd, Launchd]),
  paths: ServicePaths,
  logs: Schema.Union([Journal, LogFile]),
  hookCommand: Schema.String,
  claudeSettingsFiles: Schema.Array(Schema.String),
}) {}

export class UninstalledService extends Schema.Class<UninstalledService>('UninstalledService')({
  stopped: Schema.Boolean,
  removed: Schema.Array(Schema.String),
}) {}

const ConfigHome = xdgHome('XDG_CONFIG_HOME', '.config')

const CrookConfigDirectory = Config.map(ConfigHome, (configHome) => `${configHome}/crook`)

const SystemdUserUnitDirectory = Config.map(
  ConfigHome,
  (configHome) => `${configHome}/systemd/user`,
)

const LaunchdLogFile = Config.map(
  Config.String('HOME'),
  (home) => `${home}/Library/Logs/${LAUNCHD_LABEL}.log`,
)

const CarriedSettings = Config.all(
  Arr.map(CARRIED_VARIABLES, (name) =>
    Config.option(Config.String(name)).pipe(
      Config.map(Option.map((value): EnvironmentEntry => ({ name, value }))),
    ),
  ),
)

const AgentSettings = Config.all({
  hubUrl: CrookHubUrl,
  hubToken: CrookHubToken,
  machine: CrookMachineId,
  label: CrookMachineLabel,
  hookSocket: CrookHookSocketPath,
  carried: CarriedSettings,
  carriedAsTheAgentReadsThem: Config.all([
    HerdrSocketPath,
    CrookAuditLogPath,
    CrookAuditPolicy,
    CrookCreatedPanesPath,
    CrookRecentPlacesPath,
  ]),
})

export const serviceTargetOf = (
  platform: string,
  userId: Option.Option<number>,
): Result.Result<ServiceTarget, ServicePlatformUnsupported> =>
  Match.value(platform).pipe(
    Match.when(LINUX, (): Result.Result<ServiceTarget, ServicePlatformUnsupported> =>
      Result.succeed(new Systemd()),
    ),
    Match.when(MACOS, () =>
      Option.match(userId, {
        onNone: () => Result.fail(new ServicePlatformUnsupported({ platform })),
        onSome: (id) => Result.succeed(new Launchd({ userId: id })),
      }),
    ),
    Match.orElse(() => Result.fail(new ServicePlatformUnsupported({ platform }))),
  )

export const runningServiceTarget = Effect.suspend(() =>
  Effect.fromResult(serviceTargetOf(process.platform, Option.fromUndefinedOr(process.getuid?.()))),
)

const launchdDomain = (target: Launchd) => `gui/${target.userId}`

const launchdService = (target: Launchd) => `${launchdDomain(target)}/${LAUNCHD_LABEL}`

const servicePaths = Effect.fn('ServiceInstaller.servicePaths')(function* (target: ServiceTarget) {
  const configDirectory = yield* CrookConfigDirectory
  const environmentFile = `${configDirectory}/${ENVIRONMENT_FILE_NAME}`

  return yield* Match.value(target).pipe(
    Match.tagsExhaustive({
      Systemd: () =>
        Effect.map(SystemdUserUnitDirectory, (unitDirectory): ServicePaths => ({
          definitionFile: `${unitDirectory}/${SYSTEMD_UNIT_NAME}`,
          environmentFile,
        })),
      Launchd: () =>
        Effect.map(Config.String('HOME'), (home): ServicePaths => ({
          definitionFile: `${home}/Library/LaunchAgents/${LAUNCHD_LABEL}.plist`,
          environmentFile,
        })),
    }),
  )
})

const environmentOf = (
  settings: Config.Success<typeof AgentSettings>,
): readonly EnvironmentEntry[] =>
  pipe(
    [
      { name: 'CROOK_HUB_URL', value: settings.hubUrl.href },
      { name: 'CROOK_HUB_TOKEN', value: Redacted.value(settings.hubToken) },
      { name: 'CROOK_MACHINE_ID', value: settings.machine },
    ],
    Arr.appendAll(
      Option.toArray(
        Option.map(settings.label, (label) => ({ name: 'CROOK_MACHINE_LABEL', value: label })),
      ),
    ),
    Arr.append({ name: 'CROOK_HOOK_SOCKET_PATH', value: settings.hookSocket }),
    Arr.appendAll(Arr.getSomes(settings.carried)),
  )

const definitionOf = (target: ServiceTarget, program: readonly string[], paths: ServicePaths) =>
  Match.value(target).pipe(
    Match.tagsExhaustive({
      Systemd: () =>
        Effect.succeed({
          definition: systemdUnit({ program, environmentFile: paths.environmentFile }),
          logs: new Journal(),
        }),
      Launchd: () =>
        Effect.map(LaunchdLogFile, (logFile) => ({
          definition: launchdPlist({ program, environmentFile: paths.environmentFile, logFile }),
          logs: new LogFile({ file: logFile }),
        })),
    }),
  )

const makeFiles = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem
  const writeAtomically = yield* makeWriteAtomically

  const unwritable = (file: string) =>
    Effect.mapError(
      (error: PlatformError) => new ServiceFileUnwritable({ path: file, detail: error.message }),
    )

  const write = (file: string, content: string, options: WriteAtomicallyOptions = {}) =>
    writeAtomically(file, content, options).pipe(unwritable(file))

  const present = (file: string) => fileSystem.exists(file).pipe(unwritable(file))

  const remove = (file: string) => fileSystem.remove(file).pipe(unwritable(file))

  const removeIfPresent = (file: string) =>
    present(file).pipe(
      Effect.flatMap((found) =>
        found ? remove(file).pipe(Effect.as(Option.some(file))) : Effect.succeedNone,
      ),
    )

  return { write, present, remove, removeIfPresent }
})

const startCalls = (target: ServiceTarget, paths: ServicePaths) =>
  Match.value(target).pipe(
    Match.tagsExhaustive({
      Systemd: () => [
        systemctl('daemon-reload'),
        systemctl('enable', SYSTEMD_UNIT_NAME),
        systemctl('restart', SYSTEMD_UNIT_NAME),
      ],
      Launchd: (launchd) => [
        launchctl('enable', launchdService(launchd)),
        launchctl('bootstrap', launchdDomain(launchd), paths.definitionFile),
      ],
    }),
  )

const stopLaunchdAgent = Effect.fn('ServiceInstaller.stopLaunchdAgent')(function* (
  launchd: Launchd,
) {
  const manager = yield* ServiceManager
  const service = launchdService(launchd)
  const stillLoaded = manager.run(launchctl('print', service)).pipe(
    Effect.as(true),
    Effect.catchTag('ServiceManagerRefused', () => Effect.succeed(false)),
  )

  return yield* manager.run(launchctl('bootout', service)).pipe(
    Effect.as(true),
    Effect.catchTag('ServiceManagerRefused', (refused) =>
      Effect.flatMap(stillLoaded, (loaded) =>
        loaded
          ? Effect.fail(refused)
          : Effect.logDebug('launchd had no crook-agent loaded to stop', refused.message).pipe(
              Effect.as(false),
            ),
      ),
    ),
  )
})

export const installService = Effect.fn('ServiceInstaller.installService')(function* (
  target: ServiceTarget,
  program: readonly string[],
) {
  const manager = yield* ServiceManager
  const path = yield* Path.Path
  const files = yield* makeFiles
  const settings = yield* AgentSettings.pipe(
    Effect.mapError((error) => new ServiceSettingsUnreadable({ detail: error.message })),
  )
  const roots = yield* claudeRoots
  const paths = yield* servicePaths(target)
  const { definition, logs } = yield* definitionOf(target, program, paths)

  yield* files.write(paths.environmentFile, environmentFileContents(environmentOf(settings)), {
    mode: OWNER_ONLY_FILE_MODE,
  })
  yield* Match.value(target).pipe(
    Match.tagsExhaustive({ Systemd: () => Effect.void, Launchd: stopLaunchdAgent }),
  )
  yield* files.write(paths.definitionFile, definition)
  yield* Effect.forEach(startCalls(target, paths), manager.run, { discard: true })

  return new InstalledService({
    target,
    paths,
    logs,
    hookCommand: `CROOK_HOOK_SOCKET_PATH=${shellWord(settings.hookSocket)} ${shellCommand([...program, HOOK_SUBCOMMAND])}`,
    claudeSettingsFiles: Arr.map(roots, (root) => path.join(root, CLAUDE_SETTINGS_FILE_NAME)),
  })
})

export const uninstallService = Effect.fn('ServiceInstaller.uninstallService')(function* (
  target: ServiceTarget,
) {
  const manager = yield* ServiceManager
  const files = yield* makeFiles
  const paths = yield* servicePaths(target)
  const installed = yield* files.present(paths.definitionFile)
  const stopAndRemoveDefinition = Match.value(target).pipe(
    Match.tagsExhaustive({
      Systemd: () =>
        manager
          .run(systemctl('disable', '--now', SYSTEMD_UNIT_NAME))
          .pipe(
            Effect.andThen(files.remove(paths.definitionFile)),
            Effect.andThen(manager.run(systemctl('daemon-reload'))),
            Effect.as(true),
          ),
      Launchd: (launchd) =>
        stopLaunchdAgent(launchd).pipe(Effect.tap(files.remove(paths.definitionFile))),
    }),
  )
  const removedDefinition = yield* installed
    ? stopAndRemoveDefinition.pipe(
        Effect.map((stopped) => Option.some({ file: paths.definitionFile, stopped })),
      )
    : Effect.succeedNone
  const removedEnvironment = yield* files.removeIfPresent(paths.environmentFile)

  return new UninstalledService({
    stopped: Option.exists(removedDefinition, (definition) => definition.stopped),
    removed: Arr.getSomes([
      Option.map(removedDefinition, (definition) => definition.file),
      removedEnvironment,
    ]),
  })
})

const logsLine = (logs: ServiceLogs) =>
  Match.value(logs).pipe(
    Match.tagsExhaustive({
      Journal: () => `journalctl --user -u ${SYSTEMD_UNIT_NAME}`,
      LogFile: (logFile) => logFile.file,
    }),
  )

const startedLines = (installed: InstalledService) =>
  Match.value(installed.target).pipe(
    Match.tagsExhaustive({
      Systemd: () => [
        `Installed ${SYSTEMD_UNIT_NAME} as a systemd user unit, enabled it and started it.`,
        `  Unit: ${installed.paths.definitionFile}`,
        `  Settings, hub token included, readable by you only: ${installed.paths.environmentFile}`,
        `  Logs: ${logsLine(installed.logs)}`,
        'A user unit stops when your last session ends. To keep crook running while you are logged out, run: loginctl enable-linger',
      ],
      Launchd: () => [
        `Installed ${LAUNCHD_LABEL} as a launchd agent and started it.`,
        `  Agent: ${installed.paths.definitionFile}`,
        `  Settings, hub token included, readable by you only: ${installed.paths.environmentFile}`,
        `  Logs: ${logsLine(installed.logs)}`,
      ],
    }),
  )

export const installReport = (installed: InstalledService) =>
  [
    ...startedLines(installed),
    '',
    "To send Claude's tool and permission events to crook, merge this hooks block into each of these files yourself; crook never edits them:",
    ...Arr.map(installed.claudeSettingsFiles, (file) => `  ${file}`),
    '',
    hooksBlock(installed.hookCommand),
  ].join('\n')

export const uninstallReport = (uninstalled: UninstalledService) =>
  Arr.match(uninstalled.removed, {
    onEmpty: () => 'crook-agent was not installed as a service, so nothing changed.',
    onNonEmpty: (removed) =>
      [
        uninstalled.stopped
          ? 'Stopped crook-agent and removed:'
          : 'crook-agent was not running, so nothing was stopped. Removed what an earlier install left behind:',
        ...Arr.map(removed, (file) => `  ${file}`),
        "Claude's settings still name the crook hook; remove that hooks block yourself if you no longer want it.",
      ].join('\n'),
  })
