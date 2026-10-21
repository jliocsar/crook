import { expect, it } from '@effect/vitest'

import { shellQuoted } from '@crook/domain/ShellQuoting'

it('wraps a word in single quotes and closes and reopens them around each single quote', () => {
  expect(shellQuoted('/home/jc/my tools')).toBe("'/home/jc/my tools'")
  expect(shellQuoted("it's $HOME")).toBe(String.raw`'it'\''s $HOME'`)
})
