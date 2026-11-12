import { describe, expect, it } from '@effect/vitest'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as TestClock from 'effect/testing/TestClock'

import { fingerPause, pause, PlaybackSpeed } from '../../stories/StageDom.ts'

describe('a story pause', () => {
  it.effect('takes its share of the playback speed', () =>
    Effect.gen(function* () {
      const waiting = yield* Effect.forkChild(
        pause(1000).pipe(Effect.provideService(PlaybackSpeed, 4)),
      )

      yield* TestClock.adjust(Duration.millis(249))

      expect(waiting.pollUnsafe()).toBeUndefined()

      yield* TestClock.adjust(Duration.millis(1))

      expect(waiting.pollUnsafe()).toBeDefined()
    }),
  )

  it.effect('waits for nothing at the smoke test speed', () =>
    Effect.gen(function* () {
      const waiting = yield* Effect.forkChild(
        pause(1000).pipe(Effect.provideService(PlaybackSpeed, Number.POSITIVE_INFINITY)),
      )

      yield* TestClock.adjust(Duration.zero)

      expect(waiting.pollUnsafe()).toBeDefined()
    }),
  )

  it.effect('keeps a finger in real time at any speed', () =>
    Effect.gen(function* () {
      const holding = yield* Effect.forkChild(
        fingerPause(16).pipe(Effect.provideService(PlaybackSpeed, Number.POSITIVE_INFINITY)),
      )

      yield* TestClock.adjust(Duration.millis(15))

      expect(holding.pollUnsafe()).toBeUndefined()

      yield* TestClock.adjust(Duration.millis(1))

      expect(holding.pollUnsafe()).toBeDefined()
    }),
  )
})
