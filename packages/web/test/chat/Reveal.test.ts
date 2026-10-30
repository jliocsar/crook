import { describe, expect, it } from 'vitest'

import { EMPTY_REVEAL_PLAN, liftFor, nextRevealPlan } from '@crook/web/chat/Reveal'
import type { RevealPlan, RevealRow } from '@crook/web/chat/Reveal'

const ANIMATED = { animate: true }
const STILL_OPTIONS = { animate: false }
const WORKING: RevealRow = { key: 'working', placeholder: true }

const rows = (...keys: readonly string[]): readonly RevealRow[] => keys.map((key) => ({ key }))

const settledOn = (shown: readonly RevealRow[]): RevealPlan =>
  nextRevealPlan(EMPTY_REVEAL_PLAN, shown, STILL_OPTIONS)

describe('nextRevealPlan', () => {
  it('lets the working row leave as a ghost when the answer takes its place', () => {
    const before = settledOn([...rows('prompt'), WORKING])
    const plan = nextRevealPlan(before, rows('prompt', 'text', 'tool'), ANIMATED)

    expect(plan.departed).toStrictEqual(['working'])
    expect(plan.placeholders.size).toBe(0)
  })

  it('keeps the working row in place while rows land above it', () => {
    const before = settledOn([...rows('prompt'), WORKING])
    const plan = nextRevealPlan(before, [...rows('prompt', 'text'), WORKING], ANIMATED)

    expect(plan.departed).toStrictEqual([])
    expect([...plan.placeholders]).toStrictEqual(['working'])
  })

  it('lets nothing leave as a ghost while the thread is still loading or motion is reduced', () => {
    const before = settledOn([...rows('prompt'), WORKING])
    const plan = nextRevealPlan(before, rows('prompt', 'text'), STILL_OPTIONS)

    expect(plan.departed).toStrictEqual([])
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
