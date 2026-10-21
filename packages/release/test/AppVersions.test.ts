import * as BunServices from '@effect/platform-bun/BunServices'
import { expect, layer } from '@effect/vitest'
import * as Effect from 'effect/Effect'
import * as Str from 'effect/String'
import * as Stream from 'effect/Stream'
import * as ChildProcess from 'effect/process/ChildProcess'

import { thisWorkspace, versionOfMember } from '@crook/release/Build'
import { type ReleaseApp } from '@crook/release/Targets'

const reportedVersion = Effect.fn('reportedVersion')(function* (app: ReleaseApp) {
  const workspace = yield* thisWorkspace
  const handle = yield* ChildProcess.make(
    'bun',
    [`${workspace.root}/packages/${app}/src/main.ts`, '--version'],
    { cwd: workspace.root },
  )
  const output = yield* handle.stdout.pipe(Stream.decodeText(), Stream.mkString)
  const exitCode = yield* handle.exitCode

  return { exitCode, output: Str.trim(output) }
})

layer(BunServices.layer, { excludeTestServices: true })('--version', (it) => {
  it.effect('names the app and its version, the line install.sh compares', () =>
    Effect.gen(function* () {
      const workspace = yield* thisWorkspace
      const agentVersion = yield* versionOfMember(workspace, 'agent')
      const hubVersion = yield* versionOfMember(workspace, 'hub')
      const agent = yield* reportedVersion('agent')
      const hub = yield* reportedVersion('hub')

      expect(agent).toEqual({ exitCode: 0, output: `crook-agent v${agentVersion}` })
      expect(hub).toEqual({ exitCode: 0, output: `crook-hub v${hubVersion}` })
    }),
  )
})
