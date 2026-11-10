import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { scale, translate, useTransformString } from '@crook/web/motion/TransformString'

import { stubMediaQueries } from '../MediaQueries.ts'

describe('transform strings', () => {
  it('spells a full transform', () => {
    expect(translate('Y', 6)).toBe('translateY(6px)')
    expect(translate('X', -40, '%')).toBe('translateX(-40%)')
    expect(scale(0.96)).toBe('scale(0.96)')
  })

  it('moves and scales when motion is allowed', () => {
    stubMediaQueries([])
    const { result } = renderHook(() => useTransformString())

    expect(result.current.translate('Y', 6)).toBe('translateY(6px)')
    expect(result.current.scale(0.96)).toBe('scale(0.96)')
  })
})
