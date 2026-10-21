import { describe, expect, it } from '@effect/vitest'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'

import { editPatch } from '@crook/claude/EditPatch'
import { PatchHunk } from '@crook/domain/TranscriptMessage'

const encodeHunks = Schema.encodeSync(Schema.Array(PatchHunk))

const numbered = (count: number) =>
  Array.from({ length: count }, (_unused, index) => `line ${index + 1}`).join('\n')

const patchOf = (content: string, oldString: string, newString: string, replaceAll = false) =>
  Option.map(editPatch(content, { oldString, newString, replaceAll }), encodeHunks)

describe('editPatch', () => {
  it('replaces one line inside three lines of context on each side', () => {
    expect(patchOf(`${numbered(10)}\n`, 'line 5', 'line five')).toEqual(
      Option.some([
        {
          oldStart: 2,
          oldLines: 7,
          newStart: 2,
          newLines: 7,
          lines: [
            ' line 2',
            ' line 3',
            ' line 4',
            '-line 5',
            '+line five',
            ' line 6',
            ' line 7',
            ' line 8',
          ],
        },
      ]),
    )
  })

  it('keeps the unchanged lines of a multi-line edit as context', () => {
    expect(patchOf('alpha\nbeta\ngamma\n', 'alpha\nbeta\ngamma', 'alpha\nBETA\ngamma')).toEqual(
      Option.some([
        {
          oldStart: 1,
          oldLines: 3,
          newStart: 1,
          newLines: 3,
          lines: [' alpha', '-beta', '+BETA', ' gamma'],
        },
      ]),
    )
  })

  it('removes a whole line when the old string carries its line break', () => {
    expect(patchOf('keep\ndrop\nkeep too\n', 'drop\n', '')).toEqual(
      Option.some([
        {
          oldStart: 1,
          oldLines: 3,
          newStart: 1,
          newLines: 2,
          lines: [' keep', '-drop', ' keep too'],
        },
      ]),
    )
  })

  it('gives every far-apart occurrence of a replace-all its own hunk, shifted by the ones before', () => {
    const content = `${numbered(20).replace('line 3', 'old\nline 3').replace('line 18', 'old\nline 18')}\n`
    const hunks = Option.getOrThrow(patchOf(content, 'old\n', 'new\nnew\n', true))

    expect(
      hunks.map((hunk) => [hunk.oldStart, hunk.oldLines, hunk.newStart, hunk.newLines]),
    ).toEqual([
      [1, 6, 1, 7],
      [16, 7, 17, 8],
    ])
  })

  it('has no patch when the old string is not in the file', () => {
    expect(patchOf('hello\n', 'goodbye', 'world')).toEqual(Option.none())
    expect(patchOf('hello\n', '', 'world')).toEqual(Option.none())
  })
})
