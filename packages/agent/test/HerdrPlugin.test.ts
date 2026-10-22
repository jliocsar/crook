import * as BunServices from '@effect/platform-bun/BunServices'
import { expect, layer } from '@effect/vitest'
import * as Arr from 'effect/Array'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Schema from 'effect/Schema'
import * as Stream from 'effect/Stream'
import * as ChildProcess from 'effect/process/ChildProcess'

import packageJson from '../package.json' with { type: 'json' }

interface Sandbox {
  readonly root: string
  readonly plugin: string
  readonly installDirectory: string
  readonly agentCalls: string
  readonly installerCalls: string
  readonly herdrCalls: string
  readonly herdrSockets: string
  readonly pluginState: string
}

interface Run {
  readonly input?: string
  readonly withAgent?: boolean
  readonly failing?: string
  readonly refusing?: string
}

const PLUGIN_DIRECTORY = `${import.meta.dirname}/../plugin`
const MANIFEST = `${PLUGIN_DIRECTORY}/herdr-plugin.toml`
const SCRIPT = 'crook.sh'
const SYSTEM_PATH = '/usr/bin:/bin'
const EXECUTABLE = 0o755
const LOCAL_ID = /^[\w:-]+$/u
const PLUGIN_ID = /^[\w.:-]+$/u
const HUB_URL = 'wss://my-hub.exe.xyz/rpc/agent'
const TOKEN = 'exe1.secret-machine-token'
const SESSION_SOCKET = '/run/user/1000/herdr-session.sock'

const Entry = Schema.Struct({ id: Schema.String, command: Schema.Array(Schema.String) })

const Manifest = Schema.Struct({
  id: Schema.String,
  version: Schema.String,
  min_herdr_version: Schema.String,
  platforms: Schema.Array(Schema.String),
  startup: Schema.Array(Schema.Struct({ command: Schema.Array(Schema.String) })),
  actions: Schema.Array(Entry),
  panes: Schema.Array(Schema.Struct({ ...Entry.fields, placement: Schema.String })),
})

const encoder = new TextEncoder()

const FAKE_AGENT = `#!/bin/sh
printf '%s|%s|%s|%s\\n' "$*" "\${CROOK_HUB_URL:-}" "\${CROOK_HUB_TOKEN:-}" "\${CROOK_MACHINE_ID:-}" >> "$AGENT_CALLS"
if [ "$1" = install-service ]; then
  printf '%s\\n' "\${HERDR_SOCKET_PATH-unset}" >> "$HERDR_SOCKETS"
fi
if [ "$1" = "\${FAKE_AGENT_FAILS:-}" ]; then
  printf 'USAGE\\n  crook-agent <subcommand> [flags]\\n' >&2
  exit 1
fi
if [ "$1" = "\${FAKE_AGENT_REFUSES:-}" ]; then
  printf 'crook-agent is not installed as a service.\\n' >&2
  exit 1
fi
printf 'fake crook-agent %s\\n' "$*"
`

const FAKE_INSTALLER = `#!/bin/sh
printf '%s\\n' "$*" >> "$INSTALLER_CALLS"
mkdir -p "$CROOK_INSTALL_DIR"
cp "$FAKE_AGENT" "$CROOK_INSTALL_DIR/crook-agent"
chmod 755 "$CROOK_INSTALL_DIR/crook-agent"
`

const FAKE_HERDR = `#!/bin/sh
printf '%s\\n' "$*" >> "$HERDR_CALLS"
`

const manifest = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem
  const text = yield* fileSystem.readFileString(MANIFEST)

  return yield* Schema.decodeUnknownEffect(Manifest)(Bun.TOML.parse(text))
})

const executable = Effect.fn('executable')(function* (file: string, contents: string) {
  const fileSystem = yield* FileSystem.FileSystem

  yield* fileSystem.writeFileString(file, contents)
  yield* fileSystem.chmod(file, EXECUTABLE)
})

const sandboxWith = Effect.fn('sandboxWith')(function* (run: Run) {
  const fileSystem = yield* FileSystem.FileSystem
  const root = yield* fileSystem.makeTempDirectoryScoped()
  const sandbox: Sandbox = {
    root,
    plugin: `${root}/packages/agent/plugin`,
    installDirectory: `${root}/bin`,
    agentCalls: `${root}/agent-calls`,
    installerCalls: `${root}/installer-calls`,
    herdrCalls: `${root}/herdr-calls`,
    herdrSockets: `${root}/herdr-sockets`,
    pluginState: `${root}/plugin-state`,
  }

  yield* fileSystem.makeDirectory(sandbox.plugin, { recursive: true })
  yield* fileSystem.makeDirectory(`${root}/packages/release`, { recursive: true })
  yield* fileSystem.makeDirectory(`${root}/fakes`)
  yield* fileSystem.copyFile(`${PLUGIN_DIRECTORY}/${SCRIPT}`, `${sandbox.plugin}/${SCRIPT}`)
  yield* executable(`${root}/packages/release/install.sh`, FAKE_INSTALLER)
  yield* executable(`${root}/fakes/agent`, FAKE_AGENT)
  yield* executable(`${root}/fakes/herdr`, FAKE_HERDR)

  if (run.withAgent ?? true) {
    yield* fileSystem.makeDirectory(sandbox.installDirectory)
    yield* executable(`${sandbox.installDirectory}/crook-agent`, FAKE_AGENT)
  }

  return sandbox
})

const callsIn = Effect.fn('callsIn')(function* (file: string) {
  const fileSystem = yield* FileSystem.FileSystem
  const found = yield* fileSystem.exists(file)

  return found ? Arr.filter((yield* fileSystem.readFileString(file)).split('\n'), Boolean) : []
})

const runPlugin = Effect.fn('runPlugin')(function* (args: readonly string[], run: Run = {}) {
  const sandbox = yield* sandboxWith(run)
  const handle = yield* ChildProcess.make('sh', [SCRIPT, ...args], {
    cwd: sandbox.plugin,
    env: {
      PATH: SYSTEM_PATH,
      HOME: sandbox.root,
      CROOK_INSTALL_DIR: sandbox.installDirectory,
      HERDR_BIN_PATH: `${sandbox.root}/fakes/herdr`,
      HERDR_PLUGIN_ID: 'crook',
      HERDR_PLUGIN_STATE_DIR: sandbox.pluginState,
      HERDR_SOCKET_PATH: SESSION_SOCKET,
      FAKE_AGENT_FAILS: run.failing ?? '',
      FAKE_AGENT_REFUSES: run.refusing ?? '',
      HERDR_SOCKETS: sandbox.herdrSockets,
      AGENT_CALLS: sandbox.agentCalls,
      INSTALLER_CALLS: sandbox.installerCalls,
      HERDR_CALLS: sandbox.herdrCalls,
      FAKE_AGENT: `${sandbox.root}/fakes/agent`,
    },
    stdin: Stream.make(encoder.encode(run.input ?? '')),
  })
  const output = yield* handle.all.pipe(Stream.decodeText(), Stream.mkString)
  const exitCode = yield* handle.exitCode

  return {
    sandbox,
    exitCode,
    output,
    agentCalls: yield* callsIn(sandbox.agentCalls),
    installerCalls: yield* callsIn(sandbox.installerCalls),
    herdrCalls: yield* callsIn(sandbox.herdrCalls),
    herdrSockets: yield* callsIn(sandbox.herdrSockets),
  }
})

const machineName = Effect.gen(function* () {
  const handle = yield* ChildProcess.make('uname', ['-n'])

  return (yield* handle.stdout.pipe(Stream.decodeText(), Stream.mkString)).trim()
})

layer(BunServices.layer, { excludeTestServices: true })('herdr plugin', (live) => {
  live.effect('declares a manifest herdr accepts, at the agent version', () =>
    Effect.gen(function* () {
      const plugin = yield* manifest
      const localIds = [...plugin.actions, ...plugin.panes].map((entry) => entry.id)

      expect(plugin.version).toBe(packageJson.version)
      expect(plugin.id).toMatch(PLUGIN_ID)
      expect(plugin.platforms).toEqual(['linux', 'macos'])
      expect(Arr.every(localIds, (id) => LOCAL_ID.test(id))).toBe(true)
      expect(plugin.startup).toEqual([{ command: ['sh', SCRIPT, 'startup'] }])
    }),
  )

  live.effect('opens a popup pane of its own for every action', () =>
    Effect.gen(function* () {
      const plugin = yield* manifest
      const paneIds = plugin.panes.map((pane) => pane.id)

      expect(plugin.actions.map((action) => action.id)).toEqual([
        'connect',
        'status',
        'restart',
        'update',
      ])
      expect(plugin.actions.map((action) => action.command)).toEqual(
        paneIds.map((id) => ['sh', SCRIPT, 'open', id]),
      )
      expect(plugin.panes.map((pane) => [pane.placement, pane.command])).toEqual(
        paneIds.map((id) => ['popup', ['sh', SCRIPT, id]]),
      )
    }),
  )

  live.effect('starts the installed agent service when herdr starts', () =>
    Effect.gen(function* () {
      const result = yield* runPlugin(['startup'])

      expect(result.exitCode).toBe(0)
      expect(result.agentCalls).toEqual(['start|||'])
    }),
  )

  live.effect('exits at once when herdr starts on a machine without the agent', () =>
    Effect.gen(function* () {
      const result = yield* runPlugin(['startup'], { withAgent: false })

      expect(result.exitCode).toBe(0)
      expect(result.output).toContain('crook-agent is not installed on this machine')
      expect(result.installerCalls).toEqual([])
    }),
  )

  live.effect("opens the action's pane in the plugin's own folder", () =>
    Effect.gen(function* () {
      const result = yield* runPlugin(['open', 'status'])

      expect(result.herdrCalls).toEqual([
        `plugin pane open --plugin crook --entrypoint status --cwd ${result.sandbox.plugin}`,
      ])
    }),
  )

  live.effect(
    'connects with the address, token and machine name it asks for, and never prints the token',
    () =>
      Effect.gen(function* () {
        const result = yield* runPlugin(['connect'], {
          input: `${HUB_URL}\n${TOKEN}\nlaptop\n\n`,
        })

        expect(result.exitCode).toBe(0)
        expect(result.agentCalls).toEqual([`install-service|${HUB_URL}|${TOKEN}|laptop`])
        expect(result.output).not.toContain(TOKEN)
      }),
  )

  live.effect(
    "keeps the install report, Claude's hooks block included, in the plugin's state",
    () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem
        const result = yield* runPlugin(['connect'], { input: `${HUB_URL}\n${TOKEN}\nlaptop\n\n` })
        const report = `${result.sandbox.pluginState}/connect-report.txt`

        expect(yield* fileSystem.readFileString(report)).toBe('fake crook-agent install-service\n')
        expect(result.output).toContain('fake crook-agent install-service')
        expect(result.output).toContain(`is saved in ${report}.`)
      }),
  )

  live.effect("installs the service for herdr's default socket, not the session it runs in", () =>
    Effect.gen(function* () {
      const result = yield* runPlugin(['connect'], { input: `${HUB_URL}\n${TOKEN}\nlaptop\n\n` })

      expect(result.herdrSockets).toEqual(['unset'])
    }),
  )

  live.effect('points at the update action when the agent cannot run a command', () =>
    Effect.gen(function* () {
      const result = yield* runPlugin(['startup'], { failing: 'start' })

      expect(result.exitCode).toBe(1)
      expect(result.output).toContain('USAGE')
      expect(result.output).toContain(
        'crook-agent start failed: fake crook-agent --version is older than the start, status and restart commands this plugin runs',
      )
    }),
  )

  live.effect('passes on a refusal that is not about the release, with nothing added', () =>
    Effect.gen(function* () {
      const result = yield* runPlugin(['startup'], { refusing: 'start' })

      expect(result.exitCode).toBe(1)
      expect(result.output).toContain('crook-agent is not installed as a service.')
      expect(result.output).not.toContain('is older than')
    }),
  )

  live.effect('names the machine after its host name when the name is left empty', () =>
    Effect.gen(function* () {
      const result = yield* runPlugin(['connect'], { input: `${HUB_URL}\n${TOKEN}\n\n\n` })

      expect(result.agentCalls).toEqual([
        `install-service|${HUB_URL}|${TOKEN}|${yield* machineName}`,
      ])
    }),
  )

  live.effect('changes nothing when the hub address or the token is left empty', () =>
    Effect.gen(function* () {
      const noAddress = yield* runPlugin(['connect'], { input: '\n\n' })
      const noToken = yield* runPlugin(['connect'], { input: `${HUB_URL}\n\n\n` })

      expect(noAddress.exitCode).toBe(1)
      expect(noAddress.output).toContain('No hub address was given, so nothing was changed.')
      expect(noToken.exitCode).toBe(1)
      expect(noToken.output).toContain('No token was given, so nothing was changed.')
      expect([...noAddress.agentCalls, ...noToken.agentCalls]).toEqual([])
    }),
  )

  live.effect('installs the agent first, through its checked installer, only when asked to', () =>
    Effect.gen(function* () {
      const declined = yield* runPlugin(['connect'], { withAgent: false, input: 'n\n\n' })
      const accepted = yield* runPlugin(['connect'], {
        withAgent: false,
        input: `y\n${HUB_URL}\n${TOKEN}\nlaptop\n\n`,
      })

      expect(declined.exitCode).toBe(1)
      expect(declined.installerCalls).toEqual([])
      expect(accepted.exitCode).toBe(0)
      expect(accepted.installerCalls).toEqual(['agent'])
      expect(accepted.agentCalls).toEqual([`install-service|${HUB_URL}|${TOKEN}|laptop`])
    }),
  )

  live.effect('installs the version picked, or the latest, then restarts the agent', () =>
    Effect.gen(function* () {
      const picked = yield* runPlugin(['update'], { input: '0.2.0\n\n' })
      const latest = yield* runPlugin(['update'], { input: '\n\n' })

      expect(picked.exitCode).toBe(0)
      expect(picked.installerCalls).toEqual(['--version 0.2.0 agent'])
      expect(picked.agentCalls).toEqual(['--version|||', 'restart|||'])
      expect(latest.installerCalls).toEqual(['agent'])
    }),
  )

  live.effect('closes the update with a failure when the restart after it fails', () =>
    Effect.gen(function* () {
      const result = yield* runPlugin(['update'], { input: '\n\n', refusing: 'restart' })

      expect(result.installerCalls).toEqual(['agent'])
      expect(result.agentCalls).toEqual(['--version|||', 'restart|||'])
      expect(result.exitCode).toBe(1)
    }),
  )

  live.effect('shows the status again each time r is pressed, and closes on any other key', () =>
    Effect.gen(function* () {
      const result = yield* runPlugin(['status'], { input: 'r\nq\n' })

      expect(result.exitCode).toBe(0)
      expect(result.agentCalls).toEqual(['status|||', 'status|||'])
    }),
  )

  live.effect('restarts the agent, then shows its status', () =>
    Effect.gen(function* () {
      const result = yield* runPlugin(['restart'], { input: 'q\n' })

      expect(result.exitCode).toBe(0)
      expect(result.agentCalls).toEqual(['restart|||', 'status|||'])
    }),
  )
})
