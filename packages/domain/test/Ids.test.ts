import { describe, expect, it } from '@effect/vitest'
import * as Result from 'effect/Result'
import * as Schema from 'effect/Schema'

import { PaneId, TranscriptOffset } from '@crook/domain/Ids'

describe('Ids', () => {
  it('accepts an opaque herdr pane id', () => {
    expect(Schema.decodeSync(PaneId)('w1:p1')).toBe('w1:p1')
  })

  it('rejects an empty id', () => {
    expect(Result.isFailure(Schema.decodeResult(PaneId)(''))).toBe(true)
  })

  it('accepts a zero transcript offset', () => {
    expect(Schema.decodeSync(TranscriptOffset)(0)).toBe(0)
  })

  it('rejects a negative or fractional transcript offset', () => {
    expect(Result.isFailure(Schema.decodeResult(TranscriptOffset)(-1))).toBe(true)
    expect(Result.isFailure(Schema.decodeResult(TranscriptOffset)(1.5))).toBe(true)
  })
})
