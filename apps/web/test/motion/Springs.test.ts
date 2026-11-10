import { spring } from 'motion/react'
import { describe, expect, it } from '@effect/vitest'

import { GLIDE, MOMENTUM_GLIDE } from '@crook/web/motion/Springs'

const FROM = 300
const SAMPLES_MS = [0, 50, 100, 200, 300, 400, 500]
const SPEED = -2000

const curve = (generator: { next: (elapsed: number) => { value: number } }) =>
  SAMPLES_MS.map((elapsed) => generator.next(elapsed).value)

describe('MOMENTUM_GLIDE', () => {
  it('traces the same curve as GLIDE from rest', () => {
    const glide = curve(spring({ keyframes: [FROM, 0], ...GLIDE, duration: 500 }))
    const momentum = curve(spring({ keyframes: [FROM, 0], ...MOMENTUM_GLIDE }))

    momentum.forEach((value, index) => {
      expect(value).toBeCloseTo(glide[index] ?? Number.NaN, 0)
    })
  })

  it('keeps the speed it inherits, where GLIDE starts from rest whatever it is given', () => {
    const glide = curve(spring({ keyframes: [FROM, 0], ...GLIDE, duration: 500, velocity: SPEED }))
    const resting = curve(spring({ keyframes: [FROM, 0], ...GLIDE, duration: 500 }))
    const momentum = curve(spring({ keyframes: [FROM, 0], ...MOMENTUM_GLIDE, velocity: SPEED }))
    const still = curve(spring({ keyframes: [FROM, 0], ...MOMENTUM_GLIDE }))

    expect(glide).toStrictEqual(resting)
    expect(momentum[1]).toBeLessThan(still[1] ?? Number.NaN)
  })
})
