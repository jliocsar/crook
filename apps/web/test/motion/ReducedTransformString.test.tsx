import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { useTransformString } from '@crook/web/motion/TransformString'

import { stubMediaQueries } from '../MediaQueries.ts'

describe('transform strings under reduced motion', () => {
  it('holds still, because MotionConfig only skips named transform keys', () => {
    stubMediaQueries(['(prefers-reduced-motion)'])
    const { result } = renderHook(() => useTransformString())

    expect(result.current.translate('Y', 6)).toBe('translateY(0px)')
    expect(result.current.translate('X', -40, '%')).toBe('translateX(0%)')
    expect(result.current.scale(0.96)).toBe('scale(1)')
  })
})
