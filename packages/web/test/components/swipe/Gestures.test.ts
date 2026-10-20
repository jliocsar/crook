import { describe, expect, it } from 'vitest'

import { settlesOpen } from '@crook/web/components/swipe/Gestures'

describe('settlesOpen', () => {
  it('opens past half the actions width', () => {
    expect(settlesOpen({ offset: -73, velocity: 0, actionsWidth: 144 })).toBe(true)
    expect(settlesOpen({ offset: -72, velocity: 0, actionsWidth: 144 })).toBe(false)
  })

  it('follows a fling faster than 500px/s over the position', () => {
    expect(settlesOpen({ offset: -10, velocity: -501, actionsWidth: 144 })).toBe(true)
    expect(settlesOpen({ offset: -140, velocity: 501, actionsWidth: 144 })).toBe(false)
  })
})
