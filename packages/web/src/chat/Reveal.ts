import * as Arr from 'effect/Array'

interface RenderedRange {
  readonly startIndex: number
  readonly endIndex: number
  readonly overscan: number
  readonly count: number
}

export interface RevealRow {
  readonly key: string
}

export const departedKeys = (
  placeholders: readonly string[],
  rows: readonly RevealRow[],
): readonly string[] => Arr.filter(placeholders, (key) => !Arr.some(rows, (row) => row.key === key))

export const liftFor = (grown: number, current: number, ceiling: number): number =>
  Math.max(0, Math.min(current + grown, ceiling))

export const withTheEnd = (
  indexes: readonly number[],
  range: RenderedRange,
  following: boolean,
): number[] => {
  const atEnd = range.endIndex - range.startIndex + 1 + range.overscan
  const first = Math.max((indexes.at(-1) ?? -1) + 1, range.count - atEnd)

  return following && first < range.count
    ? [...indexes, ...Arr.range(first, range.count - 1)]
    : [...indexes]
}
