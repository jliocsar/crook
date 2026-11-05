import { describe, expect, it } from '@effect/vitest'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, vi } from 'vitest'

import { stubMediaQueries } from '../MediaQueries.ts'
import {
  answerGrows,
  catchUpLands,
  fades,
  ghost,
  lifted,
  liftOf,
  phoneViewport,
} from '../ThreadRender.tsx'

const ANSWER_HEIGHT = 300
const TALL_ROW_HEIGHT = 300
const SHORT_ROW_HEIGHT = 20
const CACHED_ROWS = 4
const LANDED_ROWS = 120

beforeEach(() => {
  stubMediaQueries(['(prefers-reduced-motion)'])
  phoneViewport()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Thread under reduced motion', () => {
  it.effect('swaps the answer in plainly, with no ghost, fade or slide', () =>
    Effect.gen(function* () {
      yield* answerGrows(ANSWER_HEIGHT)

      expect(ghost()).toBeNull()
      expect(fades('text')).toBe(false)
      expect(fades('tool')).toBe(false)
      expect(liftOf()).not.toContain(`${ANSWER_HEIGHT}px`)
    }),
  )

  it.effect('fills the screen in the commit short rows land under tall ones, with no lift', () =>
    Effect.gen(function* () {
      const landing = yield* catchUpLands(
        TALL_ROW_HEIGHT,
        CACHED_ROWS,
        SHORT_ROW_HEIGHT,
        LANDED_ROWS,
      )

      expect(lifted()).toBe(0)
      expect(landing.rowsReachUpTo).toBeLessThanOrEqual(landing.topOfTheScreen)
    }),
  )

  it.effect('lets go of the rows the first landing held when a second one lands', () =>
    Effect.gen(function* () {
      const landing = yield* catchUpLands(
        SHORT_ROW_HEIGHT,
        CACHED_ROWS,
        SHORT_ROW_HEIGHT,
        LANDED_ROWS,
      )
      const again = landing.landsAgain()

      expect(again.rowsReachUpTo).toBeGreaterThan(landing.rowsReachUpTo)
      expect(again.rowsReachUpTo).toBeLessThanOrEqual(again.topOfTheScreen)
    }),
  )
})
