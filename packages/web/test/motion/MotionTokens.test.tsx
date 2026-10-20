import * as Option from 'effect/Option'
import { describe, expect, it } from 'vitest'

import {
  motionTokens,
  parseCubicBezier,
  parseMilliseconds,
  readMotionTokens,
} from '@/motion/MotionTokens'

describe('parseMilliseconds', () => {
  it('reads a millisecond token as seconds', () => {
    expect(parseMilliseconds('180ms')).toStrictEqual(Option.some(0.18))
    expect(parseMilliseconds(' 120ms ')).toStrictEqual(Option.some(0.12))
  })

  it('refuses anything that is not milliseconds', () => {
    expect(parseMilliseconds('0.18s')).toStrictEqual(Option.none())
    expect(parseMilliseconds('')).toStrictEqual(Option.none())
  })
})

describe('parseCubicBezier', () => {
  it('reads the four control points', () => {
    expect(parseCubicBezier('cubic-bezier(0.22, 0.61, 0.36, 1)')).toStrictEqual(
      Option.some([0.22, 0.61, 0.36, 1]),
    )
  })

  it('refuses a curve without exactly four numbers', () => {
    expect(parseCubicBezier('cubic-bezier(0.22, 0.61, 0.36)')).toStrictEqual(Option.none())
    expect(parseCubicBezier('cubic-bezier(0.22, 0.61, 0.36, 1, 2)')).toStrictEqual(Option.none())
    expect(parseCubicBezier('cubic-bezier(a, 0.61, 0.36, 1)')).toStrictEqual(Option.none())
    expect(parseCubicBezier('ease-out')).toStrictEqual(Option.none())
  })
})

describe('readMotionTokens', () => {
  it('is none when a token is missing', () => {
    expect(readMotionTokens(() => '')).toStrictEqual(Option.none())
  })

  it('reads the tokens index.css defines', () => {
    const tokens = motionTokens()

    expect(tokens.tap).toStrictEqual({ duration: 0.12, ease: [0.22, 0.61, 0.36, 1] })
    expect(tokens.fade).toStrictEqual({ duration: 0.18, ease: [0.22, 0.61, 0.36, 1] })
    expect(tokens.exit).toStrictEqual({
      opacity: 0,
      transition: { duration: 0.12, ease: [0.22, 0.61, 0.36, 1] },
    })
  })
})
