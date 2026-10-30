import { describe, expect, it } from '@effect/vitest'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, vi } from 'vitest'

import { afterSpring } from '../Dom.ts'
import { stubMediaQueries } from '../MediaQueries.ts'
import { liftOf, liveTail, phoneViewport } from '../ThreadRender.tsx'

const ANSWER_HEIGHT = 300
const NEXT_BATCH_HEIGHT = 120

const lifted = (): number => Number.parseFloat(liftOf().replace('translateY(', ''))

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
})
