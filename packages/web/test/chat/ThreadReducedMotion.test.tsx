import { describe, expect, it } from '@effect/vitest'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, vi } from 'vitest'

import { stubMediaQueries } from '../MediaQueries.ts'
import { answerGrows, fades, ghost, liftOf, phoneViewport } from '../ThreadRender.tsx'

const ANSWER_HEIGHT = 300

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
})
