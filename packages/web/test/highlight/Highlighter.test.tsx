import { describe, expect, it } from '@effect/vitest'
import { render } from '@testing-library/react'
import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'

import { highlightedLines } from '@crook/web/highlight/HighlightedCode'
import { languageOfPath, renderLines } from '@crook/web/highlight/Highlighter'
import { createCodeHighlighter } from '@crook/web/highlight/Shiki'

describe('highlightedLines', () => {
  it.effect('gives one coloured row per line of a known language, by name or alias', () =>
    Effect.gen(function* () {
      const highlighter = yield* Effect.promise(() => createCodeHighlighter())
      const rows = renderLines(
        Option.getOrThrow(highlightedLines(highlighter, 'const a = 1\nlet b = 2', 'ts')),
      )
      const { container } = render(
        <code>
          {rows.map((row, index) => (
            <span key={index} data-row>
              {row}
            </span>
          ))}
        </code>,
      )
      const coloured = [...container.querySelectorAll('[data-row] span[style]')]

      expect(rows).toHaveLength(2)
      expect(container.textContent).toBe('const a = 1let b = 2')
      expect(coloured.map((span) => span.getAttribute('style'))).toContainEqual(
        expect.stringContaining('--shiki-light'),
      )
      expect(coloured.map((span) => span.getAttribute('style'))).toContainEqual(
        expect.stringContaining('--shiki-dark'),
      )
    }),
  )

  it.effect('gives nothing for a language it did not load', () =>
    Effect.gen(function* () {
      const highlighter = yield* Effect.promise(() => createCodeHighlighter())

      expect(highlightedLines(highlighter, 'fn main() {}', 'rust')).toEqual(Option.none())
    }),
  )
})

describe('languageOfPath', () => {
  it('reads the language from the file extension', () => {
    expect(languageOfPath('src/Thread.tsx')).toEqual(Option.some('tsx'))
    expect(languageOfPath('Makefile')).toEqual(Option.none())
  })
})
