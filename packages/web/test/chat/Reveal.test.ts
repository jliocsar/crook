import { describe, expect, it } from 'vitest'

import {
  EMPTY_REVEAL_PLAN,
  liftFor,
  nextRevealPlan,
  revealOf,
  STILL,
  staggerDelays,
  withoutReveal,
} from '@crook/web/chat/Reveal'
import type { RevealPlan, RevealRow } from '@crook/web/chat/Reveal'

const TIMING = { step: 0.05, spread: 0.18 }
const ANIMATED = { animate: true, timing: TIMING }
const STILL_OPTIONS = { animate: false, timing: TIMING }
const WORKING: RevealRow = { key: 'working', placeholder: true }

const rows = (...keys: readonly string[]): readonly RevealRow[] => keys.map((key) => ({ key }))

const settledOn = (shown: readonly RevealRow[]): RevealPlan =>
  nextRevealPlan(EMPTY_REVEAL_PLAN, shown, STILL_OPTIONS)

describe('staggerDelays', () => {
  it('spaces a short batch by the step', () => {
    expect(staggerDelays(3, TIMING)).toStrictEqual([0, 0.05, 0.1])
  })

  it('squeezes a long batch so the last row starts within the spread', () => {
    const delays = staggerDelays(40, TIMING)

    expect(delays).toHaveLength(40)
    expect(delays.at(-1)).toBeCloseTo(0.18)
    expect(delays[1]).toBeCloseTo(0.18 / 39)
  })

  it('starts a lone row at once and plans nothing for no rows', () => {
    expect(staggerDelays(1, TIMING)).toStrictEqual([0])
    expect(staggerDelays(0, TIMING)).toStrictEqual([])
  })
})

describe('nextRevealPlan', () => {
  it('reveals nothing while the thread is still loading or motion is reduced', () => {
    const plan = nextRevealPlan(settledOn(rows('a')), rows('a', 'b', 'c'), STILL_OPTIONS)

    expect(revealOf(plan, 'b')).toStrictEqual(STILL)
    expect(revealOf(plan, 'c')).toStrictEqual(STILL)
    expect(plan.departed).toStrictEqual([])
  })

  it('staggers a batch top-down, so the text comes before the tool card after it', () => {
    const before = settledOn([...rows('prompt'), WORKING])
    const plan = nextRevealPlan(before, [...rows('prompt', 'text', 'tool'), WORKING], ANIMATED)

    expect(revealOf(plan, 'text')).toStrictEqual({ enters: true, rise: true, delay: 0 })
    expect(revealOf(plan, 'tool')).toStrictEqual({ enters: true, rise: true, delay: 0.05 })
    expect(revealOf(plan, 'working')).toStrictEqual(STILL)
    expect(revealOf(plan, 'prompt')).toStrictEqual(STILL)
  })

  it('lets the first block take the working row over in place when the working row leaves', () => {
    const before = settledOn([...rows('prompt'), WORKING])
    const plan = nextRevealPlan(before, rows('prompt', 'text', 'tool'), ANIMATED)

    expect(plan.departed).toStrictEqual(['working'])
    expect(revealOf(plan, 'text')).toStrictEqual({ enters: true, rise: false, delay: 0 })
    expect(revealOf(plan, 'tool')).toStrictEqual({ enters: true, rise: true, delay: 0.05 })
  })

  it('brings the working row back with a rise once the tool has finished', () => {
    const before = settledOn(rows('prompt', 'text', 'tool'))
    const plan = nextRevealPlan(before, [...rows('prompt', 'text', 'tool'), WORKING], ANIMATED)

    expect(revealOf(plan, 'working')).toStrictEqual({ enters: true, rise: true, delay: 0 })
    expect(plan.departed).toStrictEqual([])
  })

  it('does not animate earlier history loaded above what was already shown', () => {
    const before = settledOn(rows('c', 'd'))
    const plan = nextRevealPlan(before, rows('a', 'b', 'c', 'd'), ANIMATED)

    expect(plan.reveals.size).toBe(0)
  })

  it('forgets the previous batch once the next one arrives', () => {
    const first = nextRevealPlan(settledOn(rows('a')), rows('a', 'b'), ANIMATED)
    const second = nextRevealPlan(first, rows('a', 'b', 'c'), ANIMATED)

    expect(revealOf(second, 'b')).toStrictEqual(STILL)
    expect(revealOf(second, 'c')).toStrictEqual({ enters: true, rise: true, delay: 0 })
  })
})

describe('withoutReveal', () => {
  it('settles a row once it has been shown, and keeps the plan when there is nothing to settle', () => {
    const plan = nextRevealPlan(settledOn(rows('a')), rows('a', 'b'), ANIMATED)

    expect(revealOf(withoutReveal(plan, 'b'), 'b')).toStrictEqual(STILL)
    expect(withoutReveal(plan, 'a')).toBe(plan)
  })
})

describe('liftFor', () => {
  it('adds the growth to a lift still under way', () => {
    expect(liftFor(120, 40, 800)).toBe(160)
  })

  it('never lifts by more than a screen, however long the answer', () => {
    expect(liftFor(5000, 0, 800)).toBe(800)
  })
})
