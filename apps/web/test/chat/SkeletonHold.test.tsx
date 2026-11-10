import { describe, expect, it } from '@effect/vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, vi } from 'vitest'

import { useSkeletonHold } from '@crook/web/chat/SkeletonHold'

const FRAME_MS = 20
const FRAMES_PAST_THE_LIMIT = 30

const runFrames = (count: number) => {
  act(() => {
    for (let frame = 0; frame < count; frame += 1) {
      const callback = waiting

      waiting = undefined
      clock += FRAME_MS
      callback?.(clock)
    }
  })
}

let waiting: FrameRequestCallback | undefined
let clock = 0

beforeEach(() => {
  clock = 0
  waiting = undefined
  vi.spyOn(performance, 'now').mockImplementation(() => clock)
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    waiting = callback

    return 1
  })
  vi.stubGlobal('cancelAnimationFrame', () => {
    waiting = undefined
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('holding a skeleton', () => {
  it.effect('holds nothing when no skeleton was ever shown', () =>
    Effect.sync(() => {
      const { result } = renderHook(() => useSkeletonHold(false))

      expect(result.current).toBe(false)
    }),
  )

  it.effect('keeps holding after what it waited for arrived, until a flash is out of reach', () =>
    Effect.sync(() => {
      const { result, rerender } = renderHook(({ shown }) => useSkeletonHold(shown), {
        initialProps: { shown: true },
      })

      runFrames(2)
      rerender({ shown: false })

      expect(result.current).toBe(true)

      runFrames(FRAMES_PAST_THE_LIMIT)

      expect(result.current).toBe(false)
    }),
  )

  it.effect('counts frames as well as time, since a starved page shows few', () =>
    Effect.sync(() => {
      const { result } = renderHook(() => useSkeletonHold(true))

      clock += 1000
      runFrames(2)

      expect(result.current).toBe(true)

      runFrames(FRAMES_PAST_THE_LIMIT)

      expect(result.current).toBe(false)
    }),
  )

  it.effect('holds again when a skeleton comes back', () =>
    Effect.sync(() => {
      const { result, rerender } = renderHook(({ shown }) => useSkeletonHold(shown), {
        initialProps: { shown: true },
      })

      runFrames(FRAMES_PAST_THE_LIMIT)
      rerender({ shown: false })

      expect(result.current).toBe(false)

      rerender({ shown: true })

      expect(result.current).toBe(true)
    }),
  )
})
