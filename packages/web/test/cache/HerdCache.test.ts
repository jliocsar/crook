import { expect, layer } from '@effect/vitest'
import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'

import { HerdCache, HerdSnapshot } from '@crook/web/cache/HerdCache'

import { agent, herd, LAPTOP, machine, START } from '../HerdFixtures.ts'

const snapshot = new HerdSnapshot({
  view: herd([machine(LAPTOP, [agent('w1:p1', 'blocked', { branch: 'feat/jc-93' })])]),
  syncedAt: START,
})

layer(HerdCache.layer)('HerdCache', (it) => {
  it.effect('stores a snapshot as plain data that decodes back to the same herd', () =>
    Effect.gen(function* () {
      const stored: unknown = structuredClone(yield* Schema.encodeEffect(HerdSnapshot)(snapshot))
      const restored = yield* Schema.decodeUnknownEffect(HerdSnapshot)(stored)

      expect(restored).toEqual(snapshot)
    }),
  )

  it.effect('opens with no snapshot when the browser has no IndexedDB', () =>
    Effect.gen(function* () {
      const cache = yield* HerdCache

      expect(yield* cache.load).toEqual(Option.none())
    }),
  )
})
