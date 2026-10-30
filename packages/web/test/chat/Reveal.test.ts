import { describe, expect, it } from 'vitest'

import { departedKeys, liftFor } from '@crook/web/chat/Reveal'
import type { RevealRow } from '@crook/web/chat/Reveal'

const rows = (...keys: readonly string[]): readonly RevealRow[] => keys.map((key) => ({ key }))

describe('departedKeys', () => {
  it('lets the working row leave as a ghost when the answer takes its place', () => {
    expect(departedKeys(['working'], rows('prompt', 'text', 'tool'))).toStrictEqual(['working'])
  })

  it('keeps the working row in place while rows land above it', () => {
    expect(departedKeys(['working'], rows('prompt', 'text', 'working'))).toStrictEqual([])
  })

  it('has nothing to let go while no placeholder was shown', () => {
    expect(departedKeys([], rows('prompt', 'text'))).toStrictEqual([])
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
