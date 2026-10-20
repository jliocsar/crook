import { describe, expect, it } from 'vitest'

import { movedPastSlop } from '@crook/web/components/press/PressGesture'

describe('movedPastSlop', () => {
  it('allows 8px of wobble before a press stops counting as one', () => {
    const origin = { clientX: 100, clientY: 100 }

    expect(movedPastSlop(origin, { clientX: 108, clientY: 100 })).toBe(false)
    expect(movedPastSlop(origin, { clientX: 106, clientY: 106 })).toBe(true)
  })
})
