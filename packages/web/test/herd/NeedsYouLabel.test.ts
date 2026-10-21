import { describe, expect, it } from 'vitest'

import { needsYouLabel } from '@crook/web/herd/NeedsYouLabel'

describe('needsYouLabel', () => {
  it('agrees the verb with the count', () => {
    expect(needsYouLabel(1)).toBe('1 needs you')
    expect(needsYouLabel(2)).toBe('2 need you')
  })
})
