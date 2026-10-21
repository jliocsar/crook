import * as Arr from 'effect/Array'
import { pipe } from 'effect/Function'
import * as Option from 'effect/Option'

import { PatchHunk } from '@crook/domain/TranscriptMessage'

export interface FileEdit {
  readonly oldString: string
  readonly newString: string
  readonly replaceAll: boolean
}

interface LineSpan {
  readonly first: number
  readonly last: number
}

interface LineChange {
  readonly start: number
  readonly removed: readonly string[]
  readonly added: readonly string[]
}

const LINE_BREAK = '\n'
const LINE_BREAKS = /\n/gu
const CONTEXT_MARK = ' '
const REMOVED_MARK = '-'
const ADDED_MARK = '+'

export const PATCH_CONTEXT_LINES = 3

const linesOf = (text: string): readonly string[] => {
  const lines = text.split(LINE_BREAK)

  return text.endsWith(LINE_BREAK) || text.length === 0 ? lines.slice(0, -1) : lines
}

const occurrences = (content: string, edit: FileEdit): readonly number[] =>
  edit.oldString.length === 0
    ? []
    : Arr.unfold(content.indexOf(edit.oldString), (index) =>
        index < 0
          ? Option.none()
          : Option.some([
              index,
              edit.replaceAll ? content.indexOf(edit.oldString, index + edit.oldString.length) : -1,
            ] as const),
      )

const lineAt = (content: string, index: number) =>
  content.slice(0, index).split(LINE_BREAK).length - 1

const spanOf =
  (content: string, edit: FileEdit) =>
  (index: number): LineSpan => ({
    first: lineAt(content, index),
    last: lineAt(content, index + Math.max(edit.oldString.length - 1, 0)),
  })

const mergeSpans = (spans: readonly LineSpan[]): readonly LineSpan[] =>
  Arr.reduce(spans, Arr.empty<LineSpan>(), (merged, span) =>
    Arr.match(merged, {
      onEmpty: () => [span],
      onNonEmpty: (nonEmpty) =>
        Arr.lastNonEmpty(nonEmpty).last >= span.first
          ? Arr.modifyLastNonEmpty(nonEmpty, (previous) => ({
              first: previous.first,
              last: Math.max(previous.last, span.last),
            }))
          : [...nonEmpty, span],
    }),
  )

const commonPrefixLength = (left: readonly string[], right: readonly string[]) =>
  pipe(
    Arr.zip(left, right),
    Arr.takeWhile(([before, after]) => before === after),
    Arr.length,
  )

const lineStarts = (content: string): readonly number[] => [
  0,
  ...Array.from(content.matchAll(LINE_BREAKS), (found) => found.index + 1),
]

const replacedIn = (region: string, edit: FileEdit) =>
  edit.replaceAll
    ? region.replaceAll(edit.oldString, edit.newString)
    : region.replace(edit.oldString, edit.newString)

const regionOf = (content: string, starts: readonly number[], span: LineSpan): string =>
  content.slice(starts[span.first] ?? content.length, starts[span.last + 1] ?? content.length)

const widenedSpan =
  (content: string, starts: readonly number[], edit: FileEdit) =>
  (span: LineSpan): LineSpan => {
    const region = regionOf(content, starts, span)

    return region.endsWith(LINE_BREAK) &&
      !replacedIn(region, edit).endsWith(LINE_BREAK) &&
      span.last + 1 < starts.length - 1
      ? { first: span.first, last: span.last + 1 }
      : span
  }

const changeOf =
  (content: string, edit: FileEdit) =>
  (span: LineSpan): LineChange => {
    const starts = lineStarts(content)
    const region = regionOf(content, starts, widenedSpan(content, starts, edit)(span))
    const removed = linesOf(region)
    const added = linesOf(replacedIn(region, edit))
    const prefix = commonPrefixLength(removed, added)
    const suffix = commonPrefixLength(
      Arr.reverse(removed.slice(prefix)),
      Arr.reverse(added.slice(prefix)),
    )

    return {
      start: span.first + prefix,
      removed: removed.slice(prefix, removed.length - suffix),
      added: added.slice(prefix, added.length - suffix),
    }
  }

const endOf = (change: LineChange) => change.start + change.removed.length

const groupChanges = (changes: readonly LineChange[]): readonly (readonly LineChange[])[] =>
  Arr.reduce(changes, Arr.empty<readonly LineChange[]>(), (groups, change) =>
    Arr.match(groups, {
      onEmpty: () => [[change]],
      onNonEmpty: (nonEmpty) => {
        const group = Arr.lastNonEmpty(nonEmpty)
        const previous = group[group.length - 1]

        return previous !== undefined && change.start - endOf(previous) <= PATCH_CONTEXT_LINES * 2
          ? Arr.modifyLastNonEmpty(nonEmpty, () => [...group, change])
          : [...nonEmpty, [change]]
      },
    }),
  )

const marked = (mark: string) => (lines: readonly string[]) => lines.map((line) => `${mark}${line}`)

const hunkOf =
  (lines: readonly string[]) =>
  (group: readonly LineChange[], shift: number): Option.Option<PatchHunk> =>
    Option.all([Arr.head(group), Arr.last(group)]).pipe(
      Option.map(([first, last]) => {
        const leadStart = Math.max(first.start - PATCH_CONTEXT_LINES, 0)
        const trailEnd = Math.min(endOf(last) + PATCH_CONTEXT_LINES, lines.length)
        const body = group.flatMap((change, index) => [
          ...marked(REMOVED_MARK)(change.removed),
          ...marked(ADDED_MARK)(change.added),
          ...marked(CONTEXT_MARK)(
            lines.slice(endOf(change), group[index + 1]?.start ?? endOf(change)),
          ),
        ])
        const hunkLines = [
          ...marked(CONTEXT_MARK)(lines.slice(leadStart, first.start)),
          ...body,
          ...marked(CONTEXT_MARK)(lines.slice(endOf(last), trailEnd)),
        ]
        const oldLines = hunkLines.filter((line) => !line.startsWith(ADDED_MARK)).length
        const newLines = hunkLines.filter((line) => !line.startsWith(REMOVED_MARK)).length

        return new PatchHunk({
          oldStart: leadStart + 1,
          oldLines,
          newStart: leadStart + 1 + shift,
          newLines,
          lines: hunkLines,
        })
      }),
    )

const shiftsBefore = (groups: readonly (readonly LineChange[])[]) =>
  Arr.scan(
    groups,
    0,
    (shift, group) =>
      shift + group.reduce((sum, change) => sum + change.added.length - change.removed.length, 0),
  )

export const editPatch = (content: string, edit: FileEdit): Option.Option<readonly PatchHunk[]> => {
  const lines = linesOf(content)
  const groups = pipe(
    occurrences(content, edit),
    Arr.map(spanOf(content, edit)),
    mergeSpans,
    Arr.map(changeOf(content, edit)),
    Arr.filter((change) => change.removed.length > 0 || change.added.length > 0),
    groupChanges,
  )

  return pipe(
    Option.liftPredicate(groups, Arr.isReadonlyArrayNonEmpty),
    Option.filter(() => edit.oldString.length > 0),
    Option.map((nonEmpty) =>
      pipe(
        Arr.zip(nonEmpty, shiftsBefore(nonEmpty)),
        Arr.map(([group, shift]) => hunkOf(lines)(group, shift)),
        Arr.getSomes,
      ),
    ),
  )
}
