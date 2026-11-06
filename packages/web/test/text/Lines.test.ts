import { describe, expect, it } from '@effect/vitest'

import { foldedLines } from '@crook/web/text/Lines'

describe('foldedLines', () => {
  it('leaves what fits alone', () => {
    expect(foldedLines(['a', 'b'], 2, 10)).toEqual({ lines: ['a', 'b'], clipped: false })
    expect(foldedLines([''], 2, 10)).toEqual({ lines: [''], clipped: false })
  })

  it('stops at the line limit', () => {
    expect(foldedLines(['a', 'b', 'c'], 2, 10)).toEqual({ lines: ['a', 'b'], clipped: true })
  })

  it('stops at the character limit, inside a line if it must', () => {
    expect(foldedLines(['abcdef'], 2, 4)).toEqual({ lines: ['abcd'], clipped: true })
    expect(foldedLines(['ab', 'cd', 'ef'], 9, 5)).toEqual({ lines: ['ab', 'cd'], clipped: true })
    expect(foldedLines(['ab', 'cdef'], 9, 4)).toEqual({ lines: ['ab', 'c'], clipped: true })
  })
})
