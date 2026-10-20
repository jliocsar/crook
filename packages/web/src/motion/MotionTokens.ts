import type { TargetAndTransition, Transition } from 'motion/react'

import * as Arr from 'effect/Array'
import { pipe } from 'effect/Function'
import * as Option from 'effect/Option'
import * as Predicate from 'effect/Predicate'

type CubicBezier = readonly [number, number, number, number]

export type MotionTokens = {
  readonly tap: Transition
  readonly fade: Transition
  readonly exit: TargetAndTransition
}

const MILLISECONDS_PER_SECOND = 1000
const MILLISECONDS = /^\s*(\d+(?:\.\d+)?)ms\s*$/u
const CUBIC_BEZIER = /^\s*cubic-bezier\(([^)]*)\)\s*$/u

export const parseMilliseconds = (value: string): Option.Option<number> =>
  pipe(
    Option.fromNullishOr(MILLISECONDS.exec(value)?.[1]),
    Option.map((milliseconds) => Number(milliseconds) / MILLISECONDS_PER_SECOND),
  )

export const parseCubicBezier = (value: string): Option.Option<CubicBezier> =>
  pipe(
    Option.fromNullishOr(CUBIC_BEZIER.exec(value)?.[1]),
    Option.map((list) => Arr.map(list.split(','), (point) => Number(point.trim()))),
    Option.filter((points) => Arr.every(points, Number.isFinite)),
    Option.filter((points) => Predicate.isTupleOf(points, 4)),
  )

export const readMotionTokens = (read: (property: string) => string): Option.Option<MotionTokens> =>
  Option.all({
    fast: parseMilliseconds(read('--motion-fast')),
    base: parseMilliseconds(read('--motion')),
    ease: parseCubicBezier(read('--ease-out')),
  }).pipe(
    Option.map(({ fast, base, ease }) => ({
      tap: { duration: fast, ease },
      fade: { duration: base, ease },
      exit: { opacity: 0, transition: { duration: fast, ease } },
    })),
  )

const fromDocument = (): MotionTokens => {
  const style = getComputedStyle(document.documentElement)

  return Option.getOrThrowWith(
    readMotionTokens((property) => style.getPropertyValue(property)),
    () =>
      new Error(
        'index.css must define --motion-fast and --motion in milliseconds and --ease-out as a cubic-bezier() on :root.',
      ),
  )
}

export const motionTokens = (): MotionTokens => {
  if (Option.isSome(cached)) {
    return cached.value
  }

  const tokens = fromDocument()

  cached = Option.some(tokens)

  return tokens
}

let cached: Option.Option<MotionTokens> = Option.none()
