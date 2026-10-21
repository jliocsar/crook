import * as BunRuntime from '@effect/platform-bun/BunRuntime'
import * as BunServices from '@effect/platform-bun/BunServices'
import * as Command from 'effect/cli/Command'
import * as Flag from 'effect/cli/Flag'
import * as Console from 'effect/Console'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Schema from 'effect/Schema'

import * as AgentDaemon from '@crook/agent/AgentDaemon'
import { claudeHookSettings } from '@crook/agent/ClaudeHookSettings'
import { forwardHook } from '@crook/agent/HookForwarder'
import { runningProgram } from '@crook/agent/RunningProgram'
import {
  installReport,
  installService,
  runningServiceTarget,
  uninstallReport,
  uninstallService,
} from '@crook/agent/ServiceInstaller'
import { ServiceManager } from '@crook/agent/ServiceManager'

import packageJson from '../package.json' with { type: 'json' }

const encodeSettings = Schema.encodeSync(Schema.fromJsonString(Schema.Json))

const hook = Command.make('hook', {}, () => forwardHook).pipe(
  Command.withDescription(
    'Forward the Claude hook payload on stdin to the running agent. Always exits 0 and prints nothing, so it can never answer for you or stall Claude.',
  ),
)

const hookSettings = Command.make(
  'hook-settings',
  {
    command: Flag.String('command').pipe(
      Flag.withDescription(
        'The command Claude runs for each hook, the hook subcommand of this program included, such as "bun /path/to/crook/packages/agent/src/main.ts hook".',
      ),
    ),
  },
  ({ command }) => Console.log(encodeSettings(claudeHookSettings(command))),
).pipe(
  Command.withDescription(
    "Print the hooks block that sends Claude's tool and permission events to crook. Merge it into a Claude settings file yourself; crook never edits one.",
  ),
)

const run = Command.make('run', {}, () => Layer.launch(AgentDaemon.layer)).pipe(
  Command.withDescription(
    'Run the agent: follow herdr, keep the link to the hub and run what the phone asks. The installed service runs this.',
  ),
)

const installServiceCommand = Command.make('install-service', {}, () =>
  Effect.gen(function* () {
    const target = yield* runningServiceTarget
    const program = yield* runningProgram
    const installed = yield* installService(target, program)

    yield* Console.log(installReport(installed))
  }),
).pipe(
  Command.withDescription(
    'Write crook-agent.service as a systemd user unit (a launchd agent on macOS) that runs this program, enable it and start it. Reads CROOK_HUB_URL, CROOK_HUB_TOKEN and CROOK_MACHINE_ID from the environment into an owner-only settings file, and prints the Claude hooks block to merge yourself.',
  ),
)

const uninstallServiceCommand = Command.make('uninstall-service', {}, () =>
  Effect.gen(function* () {
    const target = yield* runningServiceTarget
    const uninstalled = yield* uninstallService(target)

    yield* Console.log(uninstallReport(uninstalled))
  }),
).pipe(
  Command.withDescription(
    'Stop and disable the crook-agent service, and remove its unit and its settings file, hub token included.',
  ),
)

const crookAgent = Command.make('crook-agent').pipe(
  Command.withSubcommands([
    run,
    installServiceCommand,
    uninstallServiceCommand,
    hook,
    hookSettings,
  ]),
)

BunRuntime.runMain(
  Command.run(crookAgent, { version: packageJson.version }).pipe(
    // oxlint-disable-next-line effecttsgo/strict-effect-provide
    Effect.provide(Layer.provideMerge(ServiceManager.layer, BunServices.layer)),
  ),
)
