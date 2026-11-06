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
  quietTail,
  VIEWPORT_HEIGHT,
} from '../ThreadRender.tsx'

const ANSWER_HEIGHT = 300
const NEXT_BATCH_HEIGHT = 120
const SHORT_ROW_HEIGHT = 20
const TALL_ROW_HEIGHT = 300
const CACHED_ROWS = 4
const LANDED_ROWS = 120
const ROWS_THAT_FIT_ONCE_MEASURED = 8
const ROW_GAP = 12

const renderedMicrotasks = Effect.promise(() => Promise.resolve())

beforeEach(() => {
  stubMediaQueries([])
  phoneViewport()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Thread glide', () => {
  it.effect('keeps the lift it wrote through what motion renders right after the commit', () =>
    Effect.gen(function* () {
      const tail = yield* quietTail()

      tail.lands(['text'], ANSWER_HEIGHT)
      yield* renderedMicrotasks

      expect(lifted()).toBe(ANSWER_HEIGHT)
    }),
  )

  it.effect('pins past the lift when a second batch lands before the next frame', () =>
    Effect.gen(function* () {
      const tail = yield* quietTail()

      tail.lands(['text'], ANSWER_HEIGHT)
      yield* renderedMicrotasks
      tail.lands(['text', 'tool'], NEXT_BATCH_HEIGHT)

      expect(lifted()).toBe(ANSWER_HEIGHT + NEXT_BATCH_HEIGHT)
    }),
  )

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

  it.effect('lifts what a row measures, not what it was estimated at', () =>
    Effect.gen(function* () {
      yield* catchUpLands(TALL_ROW_HEIGHT, CACHED_ROWS, SHORT_ROW_HEIGHT, 1)

      expect(lifted()).toBe(SHORT_ROW_HEIGHT + ROW_GAP)
    }),
  )

  it.effect('lifts what a row measures when the virtualizer still reads a scroll as it lands', () =>
    Effect.gen(function* () {
      const landing = yield* catchUpLands(TALL_ROW_HEIGHT, CACHED_ROWS, SHORT_ROW_HEIGHT, 1)

      landing.scrollHeard()
      landing.landsAgain()

      expect(lifted()).toBeCloseTo(2 * (SHORT_ROW_HEIGHT + ROW_GAP))
    }),
  )

  it.effect('lifts nothing when rows estimated past the screen measure short enough to fit', () =>
    Effect.gen(function* () {
      yield* catchUpLands(
        SHORT_ROW_HEIGHT,
        CACHED_ROWS,
        SHORT_ROW_HEIGHT,
        ROWS_THAT_FIT_ONCE_MEASURED,
      )

      expect(lifted()).toBe(0)
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

  it.effect('has the rows the lift shows on the screen when a hole lands among them', () =>
    Effect.gen(function* () {
      const landing = yield* catchUpLands(
        SHORT_ROW_HEIGHT,
        CACHED_ROWS,
        SHORT_ROW_HEIGHT,
        LANDED_ROWS,
        { holeFirst: true },
      )

      expect(lifted()).toBeCloseTo(VIEWPORT_HEIGHT)
      expect(landing.rowsReachUpTo).toBeLessThanOrEqual(landing.topOfTheScreen)
    }),
  )

  it.effect('keeps the lift capped and the screen filled when rows land during a lift', () =>
    Effect.gen(function* () {
      const landing = yield* catchUpLands(
        SHORT_ROW_HEIGHT,
        CACHED_ROWS,
        SHORT_ROW_HEIGHT,
        LANDED_ROWS,
      )
      const again = landing.landsAgain()

      expect(lifted()).toBeCloseTo(VIEWPORT_HEIGHT)
      expect(again.rowsReachUpTo).toBeLessThanOrEqual(again.topOfTheScreen)
    }),
  )
})
