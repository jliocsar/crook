import * as BunRuntime from '@effect/platform-bun/BunRuntime'
import * as BunServices from '@effect/platform-bun/BunServices'
import * as Command from 'effect/cli/Command'
import * as Flag from 'effect/cli/Flag'
import * as Console from 'effect/Console'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'

import * as AgentDaemon from '@crook/agent/AgentDaemon'
import { hooksBlock } from '@crook/agent/ClaudeHookSettings'
import { forwardStdin } from '@crook/agent/HookForwarder'
import { runningProgram } from '@crook/agent/RunningProgram'
import * as ServiceControl from '@crook/agent/ServiceControl'
import * as ServiceInstaller from '@crook/agent/ServiceInstaller'
import { ServiceManager } from '@crook/agent/ServiceManager'

import packageJson from '../package.json' with { type: 'json' }

const serviceCommand = <Outcome, Failure, Requirements>(
  name: string,
  description: string,
  action: (target: ServiceInstaller.ServiceTarget) => Effect.Effect<Outcome, Failure, Requirements>,
  report: (outcome: Outcome) => string,
) =>
  Command.make(name, {}, () =>
    Effect.gen(function* () {
      const target = yield* ServiceInstaller.runningServiceTarget
      const outcome = yield* action(target)

      yield* Console.log(report(outcome))
    }),
  ).pipe(Command.withDescription(description))

const forwardHook = Effect.callback<void>((resume) => {
  forwardStdin(() => {
    resume(Effect.void)
  })
})

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
  ({ command }) => Console.log(hooksBlock(command)),
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

const installService = serviceCommand(
  'install-service',
  'Write crook-agent.service as a systemd user unit (a launchd agent on macOS) that runs this program, enable it and start it. Reads CROOK_HUB_URL, CROOK_HUB_TOKEN and CROOK_MACHINE_ID from the environment into an owner-only settings file, and prints the Claude hooks block to merge yourself.',
  (target) =>
    Effect.flatMap(runningProgram, (program) => ServiceInstaller.installService(target, program)),
  ServiceInstaller.installReport,
)

const uninstallService = serviceCommand(
  'uninstall-service',
  'Stop and disable the crook-agent service, and remove its unit and its settings file, hub token included.',
  ServiceInstaller.uninstallService,
  ServiceInstaller.uninstallReport,
)

const status = serviceCommand(
  'status',
  "Show the service's state, the running agent's version and its link to the hub.",
  ServiceControl.agentServiceStatus,
  ServiceControl.statusReport,
)

const start = serviceCommand(
  'start',
  'Start the installed crook-agent service, unless an agent already answers or no service is installed. The crook plugin for Herdr runs this when Herdr starts.',
  ServiceControl.startService,
  ServiceControl.startReport,
)

const restart = serviceCommand(
  'restart',
  'Restart the installed crook-agent service, and wait until the new agent answers on the status socket.',
  ServiceControl.restartService,
  ServiceControl.restartReport,
)

const crookAgent = Command.make('crook-agent').pipe(
  Command.withSubcommands([
    run,
    status,
    start,
    restart,
    installService,
    uninstallService,
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
