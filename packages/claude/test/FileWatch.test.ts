import { expect, layer } from '@effect/vitest'
import type * as Cause from 'effect/Cause'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Fiber from 'effect/Fiber'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as Queue from 'effect/Queue'
import * as Stream from 'effect/Stream'
import * as TestClock from 'effect/testing/TestClock'

import { FileWatch, SECOND_LOOK_QUIET } from '@crook/claude/FileWatch'

const TARGET = '/watched'
const JUST_SHORT = Duration.subtract(SECOND_LOOK_QUIET, Duration.millis(1))

const updateOf = (name: string): FileSystem.WatchEvent => ({ _tag: 'Update', path: name })

const watching = Effect.fn('watching')(function* () {
  const fromDisk = yield* Queue.unbounded<FileSystem.WatchEvent, Cause.Done>()
  const delivered = yield* Queue.unbounded<Option.Option<string>>()
  const context = yield* Layer.build(
    Layer.provide(FileWatch.layer, [
      FileSystem.layerNoop({
        watch: (_target, options) => {
          options?.onReady?.()

          return Stream.fromQueue(fromDisk)
        },
      }),
      Path.layer,
    ]),
  )
  const watch = yield* Effect.service(FileWatch).pipe(Effect.provide(context))

  const running = yield* watch.watchReady(TARGET).pipe(
    Stream.runForEach((event) => Queue.offer(delivered, event)),
    Effect.forkScoped,
  )

  expect(yield* Queue.take(delivered)).toEqual(Option.none())

  return { fromDisk, delivered, running }
})

const hear = Effect.fn('hear')(function* (
  watched: Effect.Success<ReturnType<typeof watching>>,
  ...names: readonly string[]
) {
  yield* Queue.offerAll(watched.fromDisk, names.map(updateOf))

  return yield* Effect.forEach(names, () => Queue.take(watched.delivered))
})

const settledOutput = Effect.fn('settledOutput')(function* (
  watched: Effect.Success<ReturnType<typeof watching>>,
) {
  yield* Effect.yieldNow

  return yield* Queue.clear(watched.delivered)
})

layer(Layer.empty)('FileWatch', (it) => {
  it.effect('hands an event on at once, and the same name once more after the quiet', () =>
    Effect.gen(function* () {
      const watched = yield* watching()

      expect(yield* hear(watched, 'a')).toEqual([Option.some('a')])

      yield* TestClock.adjust(JUST_SHORT)

      expect(yield* settledOutput(watched)).toEqual([])

      yield* TestClock.adjust(Duration.millis(1))

      expect(yield* Queue.take(watched.delivered)).toEqual(Option.some('a'))
    }),
  )

  it.effect('restarts the quiet on a new event, so a burst gets one second look', () =>
    Effect.gen(function* () {
      const watched = yield* watching()

      yield* hear(watched, 'a')
      yield* TestClock.adjust(JUST_SHORT)
      yield* hear(watched, 'a')
      yield* TestClock.adjust(JUST_SHORT)

      expect(yield* settledOutput(watched)).toEqual([])

      yield* TestClock.adjust(Duration.millis(1))

      expect(yield* Queue.take(watched.delivered)).toEqual(Option.some('a'))

      yield* TestClock.adjust(Duration.times(SECOND_LOOK_QUIET, 10))

      expect(yield* settledOutput(watched)).toEqual([])
    }),
  )

  it.effect('looks again at each name of a burst, and only at those', () =>
    Effect.gen(function* () {
      const watched = yield* watching()

      yield* hear(watched, 'a', 'b', 'a')
      yield* TestClock.adjust(SECOND_LOOK_QUIET)

      const secondLooks = yield* Effect.forEach([1, 2], () => Queue.take(watched.delivered))

      expect(new Set(secondLooks)).toEqual(new Set([Option.some('a'), Option.some('b')]))

      yield* hear(watched, 'c')
      yield* TestClock.adjust(SECOND_LOOK_QUIET)

      expect(yield* Queue.take(watched.delivered)).toEqual(Option.some('c'))

      yield* TestClock.adjust(SECOND_LOOK_QUIET)

      expect(yield* settledOutput(watched)).toEqual([])
    }),
  )

  it.effect('ends with the watch, with a second look still waiting', () =>
    Effect.gen(function* () {
      const watched = yield* watching()

      yield* hear(watched, 'a')
      yield* Queue.end(watched.fromDisk)
      yield* Fiber.join(watched.running)
    }),
  )
})
