import { describe, expect, it } from '@effect/vitest'

import { FIT_TOLERANCE_PX, fitFindings } from '@crook/frames/SkeletonFit'
import type { Box, FitCheck } from '@crook/frames/SkeletonFit'

const PLACE = { story: 'a/story', selector: '.row', pick: 'first' } as const

const CHECK: FitCheck = {
  name: 'a card',
  skeleton: PLACE,
  real: PLACE,
  sides: ['left', 'bottom'],
}

const BOX: Box = { left: 16, top: 100, right: 374, bottom: 200 }

describe('fitFindings', () => {
  it('accepts a skeleton inside the tolerance on the sides it names', () => {
    const skeleton = { box: { ...BOX, bottom: BOX.bottom + FIT_TOLERANCE_PX, top: 0 }, bones: 3 }

    expect(fitFindings(CHECK, skeleton, { box: BOX, bones: 0 })).toEqual([])
  })

  it('names the edge that moved past the tolerance', () => {
    const skeleton = { box: { ...BOX, bottom: BOX.bottom + FIT_TOLERANCE_PX + 1 }, bones: 3 }

    expect(fitFindings(CHECK, skeleton, { box: BOX, bones: 0 })).toEqual([
      'a card: its bottom edge sits at 202 in the skeleton and 200 on the real screen.',
    ])
  })

  it('fails a skeleton that drew nothing, which is what a first visit with no shapes does', () => {
    expect(fitFindings(CHECK, { box: BOX, bones: 0 }, { box: BOX, bones: 0 })).toEqual([
      'a card: the skeleton drew no bones.',
    ])
  })

  it('fails when either screen shows no such element', () => {
    expect(fitFindings(CHECK, { box: null, bones: 3 }, { box: BOX, bones: 0 })).toEqual([
      'a card: the skeleton showed none.',
    ])
    expect(fitFindings(CHECK, { box: BOX, bones: 3 }, { box: null, bones: 0 })).toEqual([
      'a card: the real screen showed none.',
    ])
  })
})
