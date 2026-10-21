import { describe, expect, it } from '@effect/vitest'

import { slashSuggestions } from '@crook/web/chat/Composer'

describe('slashSuggestions', () => {
  it('offers the built-ins that start with a lone typed command, and nothing once a space follows', () => {
    expect(slashSuggestions('/c')).toEqual(['/compact', '/clear'])
    expect(slashSuggestions('/compact now')).toEqual([])
    expect(slashSuggestions('fix /c')).toEqual([])
  })
})
