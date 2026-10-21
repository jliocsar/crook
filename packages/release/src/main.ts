import * as BunRuntime from '@effect/platform-bun/BunRuntime'
import * as BunServices from '@effect/platform-bun/BunServices'
import * as Arr from 'effect/Array'
import * as Command from 'effect/cli/Command'
import * as Flag from 'effect/cli/Flag'
import * as Effect from 'effect/Effect'

import * as Build from '@crook/release/Build'
import { ReleaseTarget, hostTarget } from '@crook/release/Targets'

import packageJson from '../package.json' with { type: 'json' }

const chosenTargets = Effect.fn('chosenTargets')(function* (
  targets: readonly ReleaseTarget[],
  host: boolean,
) {
  const hosts = host ? [yield* hostTarget(process.platform, process.arch)] : []
  const named = [...targets, ...hosts]

  return Arr.isArrayNonEmpty(named) ? named : ReleaseTarget.literals
})

const build = Command.make(
  'build',
  {
    targets: Flag.Literals('target', ReleaseTarget.literals).pipe(
      Flag.atLeast(0),
      Flag.withDescription(
        'A target to build the agent and the hub for. Repeat it for several; without it and without --host, every release target is built.',
      ),
    ),
    host: Flag.Boolean('host').pipe(
      Flag.withDefault(false),
      Flag.withDescription("Build for this machine's own target."),
    ),
  },
  ({ targets, host }) => Effect.flatMap(chosenTargets(targets, host), Build.build),
).pipe(
  Command.withDescription(
    'Build the web app, then compile the agent and the hub, with the web build embedded, into dist/ at the repository root.',
  ),
)

const checkVersion = Command.make(
  'check-version',
  {
    tag: Flag.String('tag').pipe(Flag.withDescription('The release tag, such as v0.1.0.')),
  },
  ({ tag }) => Build.checkVersion(tag),
).pipe(
  Command.withDescription(
    'Check that the tag is a plain release version and that the agent and the hub are both at it.',
  ),
)

const crookRelease = Command.make('crook-release').pipe(
  Command.withSubcommands([build, checkVersion]),
)

const release = Command.run(crookRelease, { version: packageJson.version })

// oxlint-disable-next-line effecttsgo/strict-effect-provide
BunRuntime.runMain(release.pipe(Effect.provide(BunServices.layer)))
