import { describe, expect, it, layer } from '@effect/vitest'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Ref from 'effect/Ref'

import { HerdCache, HerdCacheUnavailable, HerdSnapshot } from '@crook/web/cache/HerdCache'

import { agent, herd, LAPTOP, machine, START } from '../HerdFixtures.ts'

const snapshot = new HerdSnapshot({
  view: herd([machine(LAPTOP, [agent('w1:p1', 'blocked', { branch: 'feat/jc-93' })])]),
  syncedAt: START,
})

const cacheOverMemory = Effect.fn('cacheOverMemory')(function* (initial: Option.Option<unknown>) {
  const stored = yield* Ref.make(initial)
  const context = yield* Layer.build(
    HerdCache.layerOver({
      read: Effect.map(Ref.get(stored), Option.getOrUndefined),
      write: (value) => Ref.set(stored, Option.some(structuredClone(value))),
      remove: Ref.set(stored, Option.none()),
    }),
  )

  return { cache: Context.get(context, HerdCache), stored }
})

describe('HerdCache', () => {
  it.effect('saves a snapshot as plain data that loads back as the same herd', () =>
    Effect.gen(function* () {
      const { cache } = yield* cacheOverMemory(Option.none())

      expect(yield* cache.load).toEqual(Option.none())

      yield* cache.save(snapshot)

      expect(yield* cache.load).toEqual(Option.some(snapshot))
    }),
  )

  it.effect('forgets the saved snapshot on clear', () =>
    Effect.gen(function* () {
      const { cache } = yield* cacheOverMemory(Option.none())

      yield* cache.save(snapshot)
      yield* cache.clear

      expect(yield* cache.load).toEqual(Option.none())
    }),
  )

  it.effect('ignores a cached herd from an older build', () =>
    Effect.gen(function* () {
      const { cache } = yield* cacheOverMemory(Option.some({ machines: [], syncedAt: 0 }))

      expect(yield* cache.load).toEqual(Option.none())
    }),
  )

  it.effect(
    'opens with no snapshot and keeps saving and clearing quietly when the browser refuses storage',
    () =>
      Effect.gen(function* () {
        const refused = new HerdCacheUnavailable({ cause: 'quota exceeded' })
        const context = yield* Layer.build(
          HerdCache.layerOver({
            read: Effect.fail(refused),
            write: () => Effect.fail(refused),
            remove: Effect.fail(refused),
          }),
        )
        const cache = Context.get(context, HerdCache)

        expect(yield* cache.load).toEqual(Option.none())

        yield* cache.save(snapshot)
        yield* cache.clear
      }),
  )
})

layer(HerdCache.layer)('HerdCache over IndexedDB', (overIndexedDb) => {
  overIndexedDb.effect('opens with no snapshot when the browser has no IndexedDB', () =>
    Effect.gen(function* () {
      const cache = yield* HerdCache

      expect(yield* cache.load).toEqual(Option.none())
    }),
  )
})
