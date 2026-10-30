import * as Arr from 'effect/Array'

export interface RevealRow {
  readonly key: string
}

export const departedKeys = (
  placeholders: readonly string[],
  rows: readonly RevealRow[],
): readonly string[] => Arr.filter(placeholders, (key) => !Arr.some(rows, (row) => row.key === key))

export const liftFor = (grown: number, current: number, ceiling: number): number =>
  Math.max(0, Math.min(current + grown, ceiling))
