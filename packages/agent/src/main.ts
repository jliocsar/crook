import * as BunRuntime from '@effect/platform-bun/BunRuntime'
import * as BunServices from '@effect/platform-bun/BunServices'
import * as Command from 'effect/cli/Command'
import * as Flag from 'effect/cli/Flag'
import * as Console from 'effect/Console'
import * as Effect from 'effect/Effect'
import * as Schema from 'effect/Schema'

import { claudeHookSettings } from '@crook/agent/ClaudeHookSettings'
import { forwardHook } from '@crook/agent/HookForwarder'

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

const crookAgent = Command.make('crook-agent').pipe(Command.withSubcommands([hook, hookSettings]))

BunRuntime.runMain(
  // oxlint-disable-next-line effecttsgo/strict-effect-provide
  Command.run(crookAgent, { version: packageJson.version }).pipe(Effect.provide(BunServices.layer)),
)
