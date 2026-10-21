import * as BunServices from '@effect/platform-bun/BunServices'
import { expect, it, layer } from '@effect/vitest'
import * as ConfigProvider from 'effect/ConfigProvider'
import * as Arr from 'effect/Array'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import { pipe } from 'effect/Function'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as Queue from 'effect/Queue'
import * as Record from 'effect/Record'
import * as Result from 'effect/Result'

import { programFrom } from '@crook/agent/RunningProgram'
import { systemdUnit } from '@crook/agent/ServiceDefinition'
import {
  Launchd,
  LogFile,
  ServicePlatformUnsupported,
  ServiceSettingsUnreadable,
  Systemd,
  UninstalledService,
  type ServiceTarget,
  installReport,
  installService,
  serviceTargetOf,
  uninstallReport,
  uninstallService,
} from '@crook/agent/ServiceInstaller'
import {
  ServiceManager,
  type ServiceManagerCall,
  ServiceManagerRefused,
  commandLine,
} from '@crook/agent/ServiceManager'
import { OWNER_ONLY_DIRECTORY_MODE, OWNER_ONLY_FILE_MODE } from '@crook/agent/StateDirectory'
import { DEFAULT_AUDIT_ARGUMENT_LIMIT, REDACT_NOTHING } from '@crook/domain/Audit'

import packageJson from '../package.json' with { type: 'json' }

interface Run {
  readonly target?: ServiceTarget
  readonly environment?: Record<string, string>
  readonly answer?: (call: ServiceManagerCall) => Effect.Effect<void, ServiceManagerRefused>
}

const PROGRAM = ['/opt/crook/crook-agent']
const TOKEN = 'exe1.secret-machine-token'
const HUB_URL = 'wss://my-hub.exe.xyz/rpc/agent'
const PERMISSION_BITS = 0o777
const WORLD_READABLE_FILE_MODE = 0o644
const MAC_USER = 501
const REFUSED_EXIT_CODE = 1
const WORKSPACE_SCOPE = '@crook/'
const INSTALLER_MODULE = 'ServiceInstaller.ts'
const SETTING_NAME = /'((?:CROOK|HERDR|XDG)_[A-Z_]+|CLAUDE_CONFIG_DIR)'/gu

const MEMBER_LEAVES: Readonly<Record<string, string>> = {
  '@crook/agent': '@crook/agent/ServiceInstaller',
  '@crook/claude': '@crook/claude/ClaudeRoots',
  '@crook/domain': '@crook/domain/AbsolutePath',
  '@crook/herdr': '@crook/herdr/HerdrClient',
  '@crook/protocol': '@crook/protocol/Commands',
}

const refusing =
  (...verbs: readonly string[]) =>
  (call: ServiceManagerCall) =>
    Arr.some(verbs, (verb) => call.args.includes(verb))
      ? Effect.fail(
          new ServiceManagerRefused({
            command: commandLine(call),
            exitCode: REFUSED_EXIT_CODE,
            detail: `${call.program} refused`,
          }),
        )
      : Effect.void

const settingsTheAgentReads = Effect.fn('settingsTheAgentReads')(function* () {
  const fileSystem = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const sources = yield* Effect.forEach(Record.values(MEMBER_LEAVES), (leaf) =>
    Effect.gen(function* () {
      const directory = path.dirname(yield* path.fromFileUrl(new URL(import.meta.resolve(leaf))))
      const files = yield* fileSystem.readDirectory(directory, { recursive: true })

      return yield* Effect.forEach(
        Arr.filter(files, (file) => file.endsWith('.ts') && !file.endsWith(INSTALLER_MODULE)),
        (file) => fileSystem.readFileString(path.join(directory, file)),
      )
    }),
  )

  return pipe(
    Arr.flatten(sources),
    Arr.flatMap((source) => Arr.map(Array.from(source.matchAll(SETTING_NAME)), ([, name]) => name)),
    Arr.filter((name): name is string => name !== undefined),
    Arr.dedupe,
  )
})

const scratchHome = Effect.fn('scratchHome')(function* () {
  const fileSystem = yield* FileSystem.FileSystem

  return yield* fileSystem.makeTempDirectoryScoped()
})

const environmentOf = (home: string, environment: Record<string, string> = {}) => ({
  HOME: home,
  XDG_CONFIG_HOME: `${home}/config`,
  XDG_STATE_HOME: `${home}/state`,
  CROOK_HUB_URL: HUB_URL,
  CROOK_HUB_TOKEN: TOKEN,
  CROOK_MACHINE_ID: 'laptop',
  ...environment,
})

const contextFor = Effect.fn('contextFor')(function* (home: string, run: Run) {
  const calls = yield* Queue.unbounded<ServiceManagerCall>()
  const context = yield* Layer.build(
    Layer.mergeAll(
      ServiceManager.layerTest(calls, run.answer),
      ConfigProvider.layer(ConfigProvider.fromUnknown(environmentOf(home, run.environment))),
    ),
  )

  return { context, calls: Queue.clear(calls).pipe(Effect.map((sent) => sent.map(commandLine))) }
})

const install = Effect.fn('install')(function* (home: string, run: Run = {}) {
  const { context, calls } = yield* contextFor(home, run)
  const installed = yield* installService(run.target ?? new Systemd(), PROGRAM).pipe(
    Effect.provide(context),
  )

  return { installed, calls: yield* calls }
})

const uninstall = Effect.fn('uninstall')(function* (home: string, run: Run = {}) {
  const { context, calls } = yield* contextFor(home, run)
  const uninstalled = yield* uninstallService(run.target ?? new Systemd()).pipe(
    Effect.provide(context),
  )

  return { uninstalled, calls: yield* calls }
})

const modeOf = Effect.fn('modeOf')(function* (file: string) {
  const fileSystem = yield* FileSystem.FileSystem
  const info = yield* fileSystem.stat(file)

  return info.mode & PERMISSION_BITS
})

it('runs the compiled binary as it is, and a source checkout through the bun running it', () => {
  expect(programFrom('/opt/crook/crook-agent', '/$bunfs/root/crook-agent')).toEqual([
    '/opt/crook/crook-agent',
  ])
  expect(programFrom('/usr/local/bin/bun', '/home/jc/crook/packages/agent/src/main.ts')).toEqual([
    '/usr/local/bin/bun',
    '/home/jc/crook/packages/agent/src/main.ts',
  ])
})

it('installs a systemd unit on Linux and a launchd agent on macOS, and nothing elsewhere', () => {
  expect(serviceTargetOf('linux', Option.some(1000))).toEqual(Result.succeed(new Systemd()))
  expect(serviceTargetOf('darwin', Option.some(MAC_USER))).toEqual(
    Result.succeed(new Launchd({ userId: MAC_USER })),
  )
  expect(serviceTargetOf('win32', Option.none())).toEqual(
    Result.fail(new ServicePlatformUnsupported({ platform: 'win32' })),
  )
})

layer(BunServices.layer, { excludeTestServices: true })('ServiceInstaller', (onDisk) => {
  onDisk.effect('writes the unit and an owner-only settings file, then enables and starts it', () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const home = yield* scratchHome()
      const { installed, calls } = yield* install(home)
      const unitFile = `${home}/config/systemd/user/crook-agent.service`
      const environmentFile = `${home}/config/crook/agent.env`
      const unit = yield* fileSystem.readFileString(unitFile)

      expect(installed.paths.definitionFile).toBe(unitFile)
      expect(installed.paths.environmentFile).toBe(environmentFile)
      expect(unit).toBe(systemdUnit({ program: PROGRAM, environmentFile }))
      expect(unit).not.toContain(TOKEN)
      expect(yield* fileSystem.readFileString(environmentFile)).toBe(
        [
          `CROOK_HUB_URL="${HUB_URL}"`,
          `CROOK_HUB_TOKEN="${TOKEN}"`,
          'CROOK_MACHINE_ID="laptop"',
          `CROOK_HOOK_SOCKET_PATH="${home}/state/crook/hook.sock"`,
          `XDG_STATE_HOME="${home}/state"`,
          '',
        ].join('\n'),
      )
      expect(yield* modeOf(environmentFile)).toBe(OWNER_ONLY_FILE_MODE)
      expect(yield* modeOf(`${home}/config/crook`)).toBe(OWNER_ONLY_DIRECTORY_MODE)
      expect(calls).toEqual([
        'systemctl --user daemon-reload',
        'systemctl --user enable crook-agent.service',
        'systemctl --user restart crook-agent.service',
      ])
    }),
  )

  onDisk.effect('keeps the unit and settings under ~/.config when XDG_CONFIG_HOME is unset', () =>
    Effect.gen(function* () {
      const home = yield* scratchHome()
      const { installed } = yield* install(home, {
        environment: { XDG_CONFIG_HOME: 'relative/config' },
      })

      expect(installed.paths.definitionFile).toBe(
        `${home}/.config/systemd/user/crook-agent.service`,
      )
      expect(installed.paths.environmentFile).toBe(`${home}/.config/crook/agent.env`)
    }),
  )

  onDisk.effect('closes a settings file someone left readable to others when it reinstalls', () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const home = yield* scratchHome()
      const environmentFile = `${home}/config/crook/agent.env`

      yield* fileSystem.makeDirectory(`${home}/config/crook`, { recursive: true })
      yield* fileSystem.writeFileString(environmentFile, 'CROOK_HUB_TOKEN="old"\n', {
        mode: WORLD_READABLE_FILE_MODE,
      })
      yield* fileSystem.writeFileString(`${environmentFile}.tmp`, 'stale', {
        mode: WORLD_READABLE_FILE_MODE,
      })
      yield* install(home)

      expect(yield* modeOf(environmentFile)).toBe(OWNER_ONLY_FILE_MODE)
      expect(yield* fileSystem.readFileString(environmentFile)).toContain(TOKEN)
      expect(yield* fileSystem.exists(`${environmentFile}.tmp`)).toBe(false)
    }),
  )

  onDisk.effect(
    'carries the settings the agent reads into the service, and pins the hook socket',
    () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem
        const home = yield* scratchHome()
        const { installed } = yield* install(home, {
          environment: {
            CROOK_MACHINE_LABEL: 'Work laptop',
            CLAUDE_CONFIG_DIR: `${home}/.claude-work`,
            HERDR_SOCKET_PATH: `${home}/herdr.sock`,
            CROOK_HOOK_SOCKET_PATH: `${home}/run/hook.sock`,
          },
        })
        const settings = yield* fileSystem.readFileString(installed.paths.environmentFile)

        expect(settings).toContain('CROOK_MACHINE_LABEL="Work laptop"\n')
        expect(settings).toContain(`CLAUDE_CONFIG_DIR="${home}/.claude-work"\n`)
        expect(settings).toContain(`HERDR_SOCKET_PATH="${home}/herdr.sock"\n`)
        expect(settings).toContain(`CROOK_HOOK_SOCKET_PATH="${home}/run/hook.sock"\n`)
        expect(installed.hookCommand).toBe(
          `CROOK_HOOK_SOCKET_PATH=${home}/run/hook.sock /opt/crook/crook-agent hook`,
        )
        expect(installed.claudeSettingsFiles).toEqual([
          `${home}/.claude/settings.json`,
          `${home}/.claude-work/settings.json`,
        ])
      }),
  )

  onDisk.effect(
    'prints the hooks block and the files to merge it into, and edits none of them',
    () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem
        const home = yield* scratchHome()
        const settingsFile = `${home}/.claude/settings.json`
        const userSettings = '{\n  "model": "opus"\n}\n'

        yield* fileSystem.makeDirectory(`${home}/.claude`)
        yield* fileSystem.writeFileString(settingsFile, userSettings)
        const { installed } = yield* install(home)
        const report = installReport(installed)

        expect(report).toContain(`  ${home}/.claude/settings.json\n`)
        expect(report).toContain(
          `"command": "CROOK_HOOK_SOCKET_PATH=${home}/state/crook/hook.sock /opt/crook/crook-agent hook"`,
        )
        expect(report).toContain('"PermissionRequest"')
        expect(report).toContain('loginctl enable-linger')
        expect(report).not.toContain(TOKEN)
        expect(yield* fileSystem.readFileString(settingsFile)).toBe(userSettings)
        expect(yield* fileSystem.readDirectory(`${home}/.claude`)).toEqual(['settings.json'])
      }),
  )

  onDisk.effect('writes nothing and starts nothing when the hub token is missing', () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const home = yield* scratchHome()
      const calls = yield* Queue.unbounded<ServiceManagerCall>()
      const context = yield* Layer.build(
        Layer.mergeAll(
          ServiceManager.layerTest(calls),
          ConfigProvider.layer(
            ConfigProvider.fromUnknown({
              HOME: home,
              CROOK_HUB_URL: HUB_URL,
              CROOK_MACHINE_ID: 'laptop',
            }),
          ),
        ),
      )
      const failure = yield* installService(new Systemd(), PROGRAM).pipe(
        Effect.provide(context),
        Effect.flip,
      )

      expect(failure).toBeInstanceOf(ServiceSettingsUnreadable)
      expect(failure.message).toContain('CROOK_HUB_TOKEN')
      expect(yield* fileSystem.exists(`${home}/.config`)).toBe(false)
      expect(yield* Queue.size(calls)).toBe(0)
    }),
  )

  onDisk.effect(
    'writes nothing and starts nothing when a carried setting is one the agent refuses',
    () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem
        const home = yield* scratchHome()
        const { context, calls } = yield* contextFor(home, {
          environment: { CROOK_AUDIT_ARGUMENT_LIMIT: 'many' },
        })
        const failure = yield* installService(new Systemd(), PROGRAM).pipe(
          Effect.provide(context),
          Effect.flip,
        )

        expect(failure).toBeInstanceOf(ServiceSettingsUnreadable)
        expect(failure.message).toContain('CROOK_AUDIT_ARGUMENT_LIMIT')
        expect(yield* fileSystem.exists(`${home}/config`)).toBe(false)
        expect(yield* calls).toEqual([])
      }),
  )

  onDisk.effect('passes on a refusal from systemctl', () =>
    Effect.gen(function* () {
      const home = yield* scratchHome()
      const refusal = new ServiceManagerRefused({
        command: 'systemctl --user restart crook-agent.service',
        exitCode: 1,
        detail: 'Job for crook-agent.service failed.',
      })
      const failure = yield* install(home, {
        answer: (call) => (call.args.includes('restart') ? Effect.fail(refusal) : Effect.void),
      }).pipe(Effect.flip)

      expect(failure).toEqual(refusal)
    }),
  )

  onDisk.effect(
    'stops a loaded launchd agent before it loads the new one, and starts it when none was',
    () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem
        const home = yield* scratchHome()
        const target = new Launchd({ userId: MAC_USER })
        const { installed, calls } = yield* install(home, {
          target,
          answer: refusing('bootout', 'print'),
        })
        const plist = yield* fileSystem.readFileString(installed.paths.definitionFile)

        expect(installed.paths.definitionFile).toBe(
          `${home}/Library/LaunchAgents/crook-agent.plist`,
        )
        expect(installed.logs).toEqual(
          new LogFile({ file: `${home}/Library/Logs/crook-agent.log` }),
        )
        expect(plist).toContain(`<string>${home}/Library/Logs/crook-agent.log</string>`)
        expect(plist).toContain(`<string>${home}/config/crook/agent.env</string>`)
        expect(plist).not.toContain(TOKEN)
        expect(calls).toEqual([
          'launchctl bootout gui/501/crook-agent',
          'launchctl print gui/501/crook-agent',
          'launchctl enable gui/501/crook-agent',
          `launchctl bootstrap gui/501 ${home}/Library/LaunchAgents/crook-agent.plist`,
        ])
      }),
  )

  onDisk.effect('stops and disables the unit, then removes it and the settings file', () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const home = yield* scratchHome()
      const { installed } = yield* install(home)
      const { uninstalled, calls } = yield* uninstall(home)

      expect(calls).toEqual([
        'systemctl --user disable --now crook-agent.service',
        'systemctl --user daemon-reload',
      ])
      expect(uninstalled.removed).toEqual([
        installed.paths.definitionFile,
        installed.paths.environmentFile,
      ])
      expect(yield* fileSystem.exists(installed.paths.definitionFile)).toBe(false)
      expect(yield* fileSystem.exists(installed.paths.environmentFile)).toBe(false)
      expect(uninstallReport(uninstalled)).toContain(installed.paths.environmentFile)
    }),
  )

  onDisk.effect('unloads the launchd agent and removes its plist', () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const home = yield* scratchHome()
      const target = new Launchd({ userId: MAC_USER })
      const { installed } = yield* install(home, { target })
      const { calls } = yield* uninstall(home, { target })

      expect(calls).toEqual(['launchctl bootout gui/501/crook-agent'])
      expect(yield* fileSystem.exists(installed.paths.definitionFile)).toBe(false)
    }),
  )

  onDisk.effect('keeps the unit and the settings file when systemd refuses to stop it', () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const home = yield* scratchHome()
      const { installed } = yield* install(home)
      const failure = yield* uninstall(home, { answer: refusing('disable') }).pipe(Effect.flip)

      expect(failure).toBeInstanceOf(ServiceManagerRefused)
      expect(yield* fileSystem.exists(installed.paths.definitionFile)).toBe(true)
      expect(yield* fileSystem.exists(installed.paths.environmentFile)).toBe(true)
    }),
  )

  onDisk.effect(
    'keeps the plist and the settings file when launchd refuses to unload an agent it still runs',
    () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem
        const home = yield* scratchHome()
        const target = new Launchd({ userId: MAC_USER })
        const { installed } = yield* install(home, { target })
        const calls = yield* Queue.unbounded<ServiceManagerCall>()
        const context = yield* Layer.build(
          Layer.mergeAll(
            ServiceManager.layerTest(calls, refusing('bootout')),
            ConfigProvider.layer(ConfigProvider.fromUnknown(environmentOf(home))),
          ),
        )
        const failure = yield* uninstallService(target).pipe(Effect.provide(context), Effect.flip)

        expect(failure).toBeInstanceOf(ServiceManagerRefused)
        expect(Arr.map(yield* Queue.clear(calls), commandLine)).toEqual([
          'launchctl bootout gui/501/crook-agent',
          'launchctl print gui/501/crook-agent',
        ])
        expect(yield* fileSystem.exists(installed.paths.definitionFile)).toBe(true)
        expect(yield* fileSystem.exists(installed.paths.environmentFile)).toBe(true)
      }),
  )

  onDisk.effect('removes the plist when launchd had already unloaded the agent', () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const home = yield* scratchHome()
      const target = new Launchd({ userId: MAC_USER })
      const { installed } = yield* install(home, { target })
      const { uninstalled, calls } = yield* uninstall(home, {
        target,
        answer: refusing('bootout', 'print'),
      })

      expect(calls).toEqual([
        'launchctl bootout gui/501/crook-agent',
        'launchctl print gui/501/crook-agent',
      ])
      expect(uninstalled.stopped).toBe(false)
      expect(uninstallReport(uninstalled)).toContain('crook-agent was not running')
      expect(yield* fileSystem.exists(installed.paths.definitionFile)).toBe(false)
    }),
  )

  onDisk.effect(
    'removes a settings file an earlier install left behind without claiming to stop anything',
    () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem
        const home = yield* scratchHome()
        const { installed } = yield* install(home)

        yield* fileSystem.remove(installed.paths.definitionFile)
        const { uninstalled, calls } = yield* uninstall(home)

        expect(calls).toEqual([])
        expect(uninstalled).toEqual(
          new UninstalledService({ stopped: false, removed: [installed.paths.environmentFile] }),
        )
        expect(uninstallReport(uninstalled)).not.toContain('Stopped')
        expect(yield* fileSystem.exists(installed.paths.environmentFile)).toBe(false)
      }),
  )

  onDisk.effect('carries every setting the agent reads into the service', () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const home = yield* scratchHome()
      const names = yield* settingsTheAgentReads()
      const { installed } = yield* install(home, {
        environment: {
          ...pipe(
            Arr.difference(names, Record.keys(environmentOf(home))),
            Arr.map((name) => [name, `${home}/settings/${name}`] as const),
            Record.fromEntries,
          ),
          CROOK_AUDIT_ARGUMENT_LIMIT: String(DEFAULT_AUDIT_ARGUMENT_LIMIT),
          CROOK_AUDIT_REDACT: REDACT_NOTHING,
        },
      })
      const written = yield* fileSystem.readFileString(installed.paths.environmentFile)
      const writtenNames = Arr.map(written.split('\n'), (line) => line.split('=')[0] ?? '')

      expect(Record.keys(MEMBER_LEAVES)).toEqual(
        pipe(
          Record.keys(packageJson.dependencies),
          Arr.filter((name) => name.startsWith(WORKSPACE_SCOPE)),
          Arr.prepend(packageJson.name),
        ),
      )
      expect(names).toContain('HERDR_SOCKET_PATH')
      expect(Arr.difference(names, writtenNames)).toEqual([])
    }),
  )

  onDisk.effect('changes nothing and calls nothing when no service is installed', () =>
    Effect.gen(function* () {
      const home = yield* scratchHome()
      const { uninstalled, calls } = yield* uninstall(home)

      expect(calls).toEqual([])
      expect(uninstalled.removed).toEqual([])
      expect(uninstallReport(uninstalled)).toBe(
        'crook-agent was not installed as a service, so nothing changed.',
      )
    }),
  )
})
