import * as BunServices from '@effect/platform-bun/BunServices'
import { expect, it, layer } from '@effect/vitest'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'

import {
  ServiceManager,
  ServiceManagerNotRun,
  ServiceManagerRefused,
  launchctl,
  systemctl,
} from '@crook/agent/ServiceManager'

const REFUSAL = 'Unit crook-agent.service not found.'

it('talks to the user manager, never the system one', () => {
  expect(systemctl('enable', 'crook-agent.service')).toEqual({
    program: 'systemctl',
    args: ['--user', 'enable', 'crook-agent.service'],
  })
  expect(launchctl('bootout', 'gui/501/crook-agent')).toEqual({
    program: 'launchctl',
    args: ['bootout', 'gui/501/crook-agent'],
  })
})

layer(Layer.provide(ServiceManager.layer, BunServices.layer), { excludeTestServices: true })(
  'ServiceManager',
  (live) => {
    live.effect('succeeds when the command exits 0', () =>
      Effect.gen(function* () {
        const manager = yield* ServiceManager

        yield* manager.run({ program: '/bin/sh', args: ['-c', 'echo done'] })
      }),
    )

    live.effect('reports the exit code and what the command printed on stderr', () =>
      Effect.gen(function* () {
        const manager = yield* ServiceManager
        const refused = yield* manager
          .run({ program: '/bin/sh', args: ['-c', `echo '${REFUSAL}' >&2; exit 5`] })
          .pipe(Effect.flip)

        expect(refused).toEqual(
          new ServiceManagerRefused({
            command: `/bin/sh -c echo '${REFUSAL}' >&2; exit 5`,
            exitCode: 5,
            detail: REFUSAL,
          }),
        )
      }),
    )

    live.effect('reports a command it could not start at all', () =>
      Effect.gen(function* () {
        const manager = yield* ServiceManager
        const failure = yield* manager
          .run({ program: `${import.meta.dirname}/missing-service-manager`, args: [] })
          .pipe(Effect.flip)

        expect(failure).toBeInstanceOf(ServiceManagerNotRun)
      }),
    )
  },
)
