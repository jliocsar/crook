import { describe, expect, it } from '@effect/vitest'

import { withoutLineNumbers } from '@crook/web/chat/ThreadItem'

describe('withoutLineNumbers', () => {
  it('drops the numbering Read puts before every line, in either form', () => {
    expect(withoutLineNumbers('1\timport a\n2\t\n3\texport b')).toBe('import a\n\nexport b')
    expect(withoutLineNumbers('     9→const a = 1\n    10→const b = 2')).toBe(
      'const a = 1\nconst b = 2',
    )
  })

  it('leaves text alone when any line is not numbered', () => {
    expect(withoutLineNumbers('1\tone\ntwo')).toBe('1\tone\ntwo')
  })
})
