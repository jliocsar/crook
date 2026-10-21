import { describe, expect, it } from '@effect/vitest'
import * as Effect from 'effect/Effect'

import {
  HostNotReleased,
  artifactName,
  artifactsFor,
  bunCompileTarget,
  hostTarget,
} from '@crook/release/Targets'

describe('Targets', () => {
  it('names each artifact after its app and target, and its bun target after the target', () => {
    expect(artifactName({ app: 'hub', target: 'linux-arm64' })).toBe('crook-hub-linux-arm64')
    expect(bunCompileTarget('darwin-arm64')).toBe('bun-darwin-arm64')
  })

  it('builds both apps for every target asked for, once each', () => {
    expect(artifactsFor(['linux-x64', 'darwin-arm64', 'linux-x64'])).toEqual([
      { app: 'agent', target: 'linux-x64' },
      { app: 'hub', target: 'linux-x64' },
      { app: 'agent', target: 'darwin-arm64' },
      { app: 'hub', target: 'darwin-arm64' },
    ])
  })

  it.effect('reads the host target from the platform and architecture Bun reports', () =>
    Effect.gen(function* () {
      expect(yield* hostTarget('linux', 'arm64')).toBe('linux-arm64')
      expect(yield* Effect.flip(hostTarget('darwin', 'x64'))).toEqual(
        new HostNotReleased({ host: 'darwin-x64' }),
      )
    }),
  )
})
