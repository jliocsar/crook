import { structuredPatch } from 'diff'
import * as Arr from 'effect/Array'
import { pipe } from 'effect/Function'
import * as Option from 'effect/Option'

import { PatchHunk } from '@crook/domain/TranscriptMessage'

export interface FileEdit {
  readonly oldString: string
  readonly newString: string
  readonly replaceAll: boolean
}

const NO_FILE_NAME = ''

export const PATCH_CONTEXT_LINES = 3

const editedContent = (content: string, edit: FileEdit) =>
  edit.replaceAll
    ? content.replaceAll(edit.oldString, () => edit.newString)
    : content.replace(edit.oldString, () => edit.newString)

const hunksOf = (content: string, edited: string): readonly PatchHunk[] =>
  structuredPatch(NO_FILE_NAME, NO_FILE_NAME, content, edited, NO_FILE_NAME, NO_FILE_NAME, {
    context: PATCH_CONTEXT_LINES,
  }).hunks.map(
    (hunk) =>
      new PatchHunk({
        oldStart: hunk.oldStart,
        oldLines: hunk.oldLines,
        newStart: hunk.newStart,
        newLines: hunk.newLines,
        lines: hunk.lines,
      }),
  )

export const editPatch = (content: string, edit: FileEdit): Option.Option<readonly PatchHunk[]> =>
  pipe(
    Option.liftPredicate(
      edit,
      (found) => found.oldString.length > 0 && content.includes(found.oldString),
    ),
    Option.map((found) => hunksOf(content, editedContent(content, found))),
    Option.filter(Arr.isReadonlyArrayNonEmpty),
  )
