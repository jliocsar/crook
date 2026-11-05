import type { TargetAndTransition, Transition } from 'motion/react'

import * as Arr from 'effect/Array'
import * as Duration from 'effect/Duration'
import { pipe } from 'effect/Function'
import * as Option from 'effect/Option'
import * as Predicate from 'effect/Predicate'

type CubicBezier = readonly [number, number, number, number]

export type MotionTokens = {
  readonly tap: Transition
  readonly fade: { readonly duration: number; readonly ease: CubicBezier }
  readonly slow: Transition
  readonly exit: TargetAndTransition
}

const CSS_TIME = /^\s*(\d*\.?\d+)(ms|s)\s*$/u
const CUBIC_BEZIER = /^\s*cubic-bezier\(([^)]*)\)\s*$/u

export const parseCssTime = (value: string): Option.Option<number> =>
  pipe(
    Option.fromNullishOr(CSS_TIME.exec(value)),
    Option.flatMap((match) =>
      Option.all([Option.fromNullishOr(match[1]), Option.fromNullishOr(match[2])]),
    ),
    Option.map(([amount, unit]) =>
      unit === 'ms' ? Duration.toSeconds(Duration.millis(Number(amount))) : Number(amount),
    ),
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
    fast: parseCssTime(read('--motion-fast')),
    base: parseCssTime(read('--motion')),
    slow: parseCssTime(read('--motion-slow')),
    ease: parseCubicBezier(read('--ease-out')),
  }).pipe(
    Option.map(({ fast, base, slow, ease }) => ({
      tap: { duration: fast, ease },
      fade: { duration: base, ease },
      slow: { duration: slow, ease },
      exit: { opacity: 0, transition: { duration: fast, ease } },
    })),
  )

const fromDocument = (): MotionTokens => {
  const style = getComputedStyle(document.documentElement)

  return Option.getOrThrowWith(
    readMotionTokens((property) => style.getPropertyValue(property)),
    () =>
      new Error(
        'index.css must define --motion-fast, --motion and --motion-slow as CSS times and --ease-out as a cubic-bezier() on :root.',
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
