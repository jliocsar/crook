import { describe, expect, it } from '@effect/vitest'

import { bandsOf, movedSince } from '@crook/frames/ThreadBands'
import type { VerticalBox } from '@crook/frames/ThreadBands'

const box = (top: number, bottom: number): VerticalBox => ({ top, bottom, height: bottom - top })

const VIEWPORT = box(100, 700)
const TALL_CONTENT = box(-2000, 3000)

describe('bandsOf', () => {
  it('reads rows that fill the viewport as no band at all', () => {
    const rows = [box(0, 300), box(300, 500), box(500, 800)]

    expect(bandsOf(VIEWPORT, TALL_CONTENT, rows)).toEqual({ top: 0, middle: 0, bottom: 0 })
  })

  it('measures what the rows leave empty above, between and below them', () => {
    const rows = [box(150, 200), box(260, 300), box(320, 650)]

    expect(bandsOf(VIEWPORT, TALL_CONTENT, rows)).toEqual({ top: 50, middle: 60, bottom: 50 })
  })

  it('reads the end of the content as no band, so a short thread has none below it', () => {
    const rows = [box(116, 200)]

    expect(bandsOf(VIEWPORT, box(100, 216), rows)).toEqual({ top: 16, middle: 0, bottom: 16 })
  })

  it('reads the whole visible content as one band when no row reaches it', () => {
    expect(bandsOf(VIEWPORT, TALL_CONTENT, [box(-400, -100), box(900, 1000)])).toEqual({
      top: 600,
      middle: 0,
      bottom: 0,
    })
  })

  it('ignores a row with no height', () => {
    expect(bandsOf(VIEWPORT, TALL_CONTENT, [box(300, 300), box(100, 700)])).toEqual({
      top: 0,
      middle: 0,
      bottom: 0,
    })
  })

  it('takes rows in the order they sit, whatever order the document holds them in', () => {
    expect(bandsOf(VIEWPORT, TALL_CONTENT, [box(400, 700), box(100, 380)])).toEqual({
      top: 0,
      middle: 20,
      bottom: 0,
    })
  })
})
describe('movedSince', () => {
  const previous = new Map([
    ['first', 100],
    ['second', 200],
  ])

  it('reads the move of the last row both frames hold, so a row landing below it does not count', () => {
    const rows = [
      { key: 'first', top: 90 },
      { key: 'second', top: 163 },
      { key: 'landed', top: 300 },
    ]

    expect(movedSince(previous, rows)).toBe(-37)
  })

  it('reads no move when the frames share no row', () => {
    expect(movedSince(previous, [{ key: 'landed', top: 300 }])).toBe(0)
  })
})
