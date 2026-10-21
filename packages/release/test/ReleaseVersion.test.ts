import { describe, expect, it } from '@effect/vitest'
import * as Effect from 'effect/Effect'

import { CrookVersion } from '@crook/domain/CrookVersion'
import { TagNotAVersion, VersionMismatch, releasedVersion } from '@crook/release/ReleaseVersion'

const RELEASED = CrookVersion.make('0.2.0')

describe('ReleaseVersion', () => {
  it.effect('releases the tagged version when the agent and the hub are both at it', () =>
    Effect.gen(function* () {
      expect(yield* releasedVersion('v0.2.0', { agent: '0.2.0', hub: '0.2.0' })).toBe(RELEASED)
    }),
  )

  it.effect('refuses a tag that is not v and a plain major.minor.patch', () =>
    Effect.gen(function* () {
      const versions = { agent: '0.2.0', hub: '0.2.0' }

      expect(yield* Effect.flip(releasedVersion('0.2.0', versions))).toEqual(
        new TagNotAVersion({ tag: '0.2.0' }),
      )
      expect(yield* Effect.flip(releasedVersion('v0.2.0-rc.1', versions))).toEqual(
        new TagNotAVersion({ tag: 'v0.2.0-rc.1' }),
      )
      expect(yield* Effect.flip(releasedVersion('vnext', versions))).toEqual(
        new TagNotAVersion({ tag: 'vnext' }),
      )
    }),
  )

  it.effect('refuses to release when the agent or the hub is at another version', () =>
    Effect.gen(function* () {
      expect(
        yield* Effect.flip(releasedVersion('v0.2.0', { agent: '0.2.0', hub: '0.1.9' })),
      ).toEqual(new VersionMismatch({ tagged: RELEASED, agent: '0.2.0', hub: '0.1.9' }))
      expect(
        yield* Effect.flip(releasedVersion('v0.2.0', { agent: '0.1.9', hub: '0.2.0' })),
      ).toEqual(new VersionMismatch({ tagged: RELEASED, agent: '0.1.9', hub: '0.2.0' }))
    }),
  )
})
