import * as Arr from 'effect/Array'
import { describe, expect, it } from 'vitest'

import { departedKeys, liftFor, withTheEnd } from '@crook/web/chat/Reveal'
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

describe('withTheEnd', () => {
  const range = { startIndex: 0, endIndex: 9, overscan: 8, count: 100 }

  it('renders the rows at the end beside the range while the thread follows', () => {
    expect(withTheEnd([0, 1, 2], range, true)).toEqual([0, 1, 2, ...Arr.range(82, 99)])
  })

  it('renders only the range once the thread stops following', () => {
    expect(withTheEnd([0, 1, 2], range, false)).toEqual([0, 1, 2])
  })

  it('repeats no row when the range already reaches the end', () => {
    const atTheEnd = Arr.range(80, 99)

    expect(withTheEnd(atTheEnd, range, true)).toEqual(atTheEnd)
  })

  it('renders nothing of a thread with no rows', () => {
    expect(withTheEnd([], { ...range, count: 0 }, true)).toEqual([])
  })

  it('joins a range that stops short of the end without repeating a row', () => {
    expect(withTheEnd(Arr.range(70, 90), range, true)).toEqual(Arr.range(70, 99))
  })
})
