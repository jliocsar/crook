import * as Arr from 'effect/Array'
import * as Option from 'effect/Option'
import { describe, expect, it } from 'vitest'

import { departedKeys, heldFrom, liftFor, reachOf, withTheEnd } from '@crook/web/chat/Reveal'
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

  it('renders down from where the lift reaches, wherever the range still sits', () => {
    expect(withTheEnd([0, 1, 2], range, true, Option.some(60))).toEqual([
      0,
      1,
      2,
      ...Arr.range(60, 99),
    ])
  })

  it('keeps the end rows it already renders when the lift reaches less far', () => {
    expect(withTheEnd([0, 1, 2], range, true, Option.some(95))).toEqual([
      0,
      1,
      2,
      ...Arr.range(82, 99),
    ])
  })

  it('renders only the range once the thread stops following, whatever the lift reaches', () => {
    expect(withTheEnd([0, 1, 2], range, false, Option.some(60))).toEqual([0, 1, 2])
  })
})

describe('reachOf', () => {
  const SCREEN = 600
  const OVERSCAN = 8

  const rowsOf = (indexes: readonly number[], pitch: number) =>
    indexes.map((index) => ({ index, start: index * pitch, end: (index + 1) * pitch }))

  it('names the row at the top of the lifted screen when the rows reach it', () => {
    const rendered = rowsOf(Arr.range(40, 99), 100)

    expect(reachOf(rendered, 300, SCREEN, OVERSCAN)).toEqual(
      Option.some({ from: 91, rendered: true }),
    )
  })

  it('counts on the height of the rows it can see to name those it has not rendered', () => {
    const rendered = rowsOf(Arr.range(80, 99), 20)

    expect(reachOf(rendered, 600, SCREEN, OVERSCAN)).toEqual(
      Option.some({ from: 32, rendered: false }),
    )
  })

  it('reads only the rows joined to the end, not a range the thread has left', () => {
    const rendered = [...rowsOf(Arr.range(0, 20), 20), ...rowsOf(Arr.range(80, 99), 20)]

    expect(reachOf(rendered, 600, SCREEN, OVERSCAN)).toEqual(
      Option.some({ from: 32, rendered: false }),
    )
  })

  it('asks for nothing above the first row of the thread', () => {
    const rendered = rowsOf(Arr.range(0, 9), 20)

    expect(reachOf(rendered, 600, SCREEN, OVERSCAN)).toEqual(
      Option.some({ from: 0, rendered: true }),
    )
  })

  it('has no reach with no rows', () => {
    expect(reachOf([], 600, SCREEN, OVERSCAN)).toEqual(Option.none())
  })
})

describe('heldFrom', () => {
  const OVERSCAN = 8

  it('moves to rows it has not rendered', () => {
    expect(heldFrom(Option.some(50), { from: 30, rendered: false }, OVERSCAN)).toBe(30)
  })

  it('takes the reach as it is when nothing is held', () => {
    expect(heldFrom(Option.none(), { from: 30, rendered: true }, OVERSCAN)).toBe(30)
  })

  it('keeps rows it has rendered when the reach sits just below them, so none remounts', () => {
    expect(heldFrom(Option.some(28), { from: 30, rendered: true }, OVERSCAN)).toBe(28)
  })

  it('lets go of rows once the reach has moved well past them', () => {
    expect(heldFrom(Option.some(28), { from: 60, rendered: true }, OVERSCAN)).toBe(52)
  })
})
