import { describe, expect, it } from '@effect/vitest'
import * as Arr from 'effect/Array'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, vi } from 'vitest'

import { afterSpring } from '../Dom.ts'
import { stubMediaQueries } from '../MediaQueries.ts'
import {
  catchUpLands,
  lifted,
  liftsWritten,
  liveTail,
  phoneViewport,
  VIEWPORT_HEIGHT,
} from '../ThreadRender.tsx'

const ANSWER_HEIGHT = 300
const NEXT_BATCH_HEIGHT = 120
const SHORT_ROW_HEIGHT = 20
const TALL_ROW_HEIGHT = 300
const CACHED_ROWS = 4
const LANDED_ROWS = 120

beforeEach(() => {
  stubMediaQueries([])
  phoneViewport()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Thread glide', () => {
  it.effect('adds a batch that lands mid-glide to the glide under way, then settles once', () =>
    Effect.gen(function* () {
      const tail = yield* liveTail()

      tail.lands(['text'], ANSWER_HEIGHT)
      yield* afterSpring(() => {
        expect(lifted()).toBeGreaterThan(0)
        expect(lifted()).toBeLessThan(ANSWER_HEIGHT)
      })

      const midGlide = lifted()

      tail.lands(['text', 'tool'], NEXT_BATCH_HEIGHT)

      expect(lifted()).toBeCloseTo(midGlide + NEXT_BATCH_HEIGHT)

      yield* afterSpring(() => {
        expect(lifted()).toBe(0)
      })
    }),
  )

  it.effect('keeps a burst taller than the screen within one screen of lift, then settles', () =>
    Effect.gen(function* () {
      const tail = yield* liveTail()
      const keys = ['first', 'second', 'third', 'fourth', 'fifth']
      const written = liftsWritten()

      for (const count of Arr.range(1, keys.length)) {
        tail.lands(keys.slice(0, count), ANSWER_HEIGHT)

        expect(lifted()).toBeGreaterThan(0)
      }

      yield* afterSpring(() => {
        expect(lifted()).toBe(0)
      })

      expect(Math.max(...written())).toBeCloseTo(VIEWPORT_HEIGHT)
    }),
  )

  it.effect('has the rows the lift shows on the screen in the commit it lands, short rows', () =>
    Effect.gen(function* () {
      const landing = yield* catchUpLands(
        SHORT_ROW_HEIGHT,
        CACHED_ROWS,
        SHORT_ROW_HEIGHT,
        LANDED_ROWS,
      )

      expect(lifted()).toBeCloseTo(VIEWPORT_HEIGHT)
      expect(landing.rowsReachUpTo).toBeLessThanOrEqual(landing.topOfTheScreen)
    }),
  )

  it.effect('has the rows the lift shows on the screen in the commit it lands, tall rows', () =>
    Effect.gen(function* () {
      const landing = yield* catchUpLands(
        TALL_ROW_HEIGHT,
        CACHED_ROWS,
        TALL_ROW_HEIGHT,
        LANDED_ROWS,
      )

      expect(lifted()).toBeCloseTo(VIEWPORT_HEIGHT)
      expect(landing.rowsReachUpTo).toBeLessThanOrEqual(landing.topOfTheScreen)
    }),
  )

  it.effect(
    'has the rows the lift shows on the screen when short rows land under a few tall ones',
    () =>
      Effect.gen(function* () {
        const landing = yield* catchUpLands(
          TALL_ROW_HEIGHT,
          CACHED_ROWS,
          SHORT_ROW_HEIGHT,
          LANDED_ROWS,
        )

        expect(landing.rowsReachUpTo).toBeLessThanOrEqual(landing.topOfTheScreen)
      }),
  )
})
