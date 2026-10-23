import { describe, expect, it } from 'vitest'

import { commitsBack } from '@crook/web/navigation/PushedScreen'

describe('commitsBack', () => {
  it('commits past a third of the width', () => {
    expect(commitsBack({ offset: 144, velocity: 0, width: 430 })).toBe(true)
    expect(commitsBack({ offset: 143, velocity: 0, width: 430 })).toBe(false)
  })

  it('commits on a fling faster than 500px/s, however short', () => {
    expect(commitsBack({ offset: 10, velocity: 501, width: 430 })).toBe(true)
    expect(commitsBack({ offset: 10, velocity: 500, width: 430 })).toBe(false)
  })
})
