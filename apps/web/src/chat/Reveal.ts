import * as Arr from 'effect/Array'
import * as Option from 'effect/Option'

interface RenderedRange {
  readonly startIndex: number
  readonly endIndex: number
  readonly overscan: number
  readonly count: number
}

interface RenderedRow {
  readonly index: number
  readonly start: number
  readonly end: number
}

export interface LiftReach {
  readonly from: number
  readonly rendered: boolean
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

export const pinWaitsForMeasures = (sizes: {
  readonly rendered: number
  readonly measured: number
  readonly scrolled: number
  readonly screen: number
}): boolean =>
  sizes.measured !== sizes.rendered && sizes.measured - sizes.screen - sizes.scrolled < sizes.screen

export const withTheEnd = (
  indexes: readonly number[],
  range: RenderedRange,
  following: boolean,
  liftedFrom: Option.Option<number> = Option.none(),
): number[] => {
  const atEnd = range.endIndex - range.startIndex + 1 + range.overscan
  const first = Math.max(
    (indexes.at(-1) ?? -1) + 1,
    Math.min(
      range.count - atEnd,
      Option.getOrElse(liftedFrom, () => range.count),
    ),
  )

  return following && first < range.count
    ? [...indexes, ...Arr.range(first, range.count - 1)]
    : [...indexes]
}

const lastRunOf = (rendered: readonly RenderedRow[]): readonly RenderedRow[] =>
  Option.match(Arr.last(rendered), {
    onNone: () => [],
    onSome: (last) =>
      Arr.filter(
        rendered,
        (row, position) => row.index - last.index === position - (rendered.length - 1),
      ),
  })

export const reachOf = (
  rendered: readonly RenderedRow[],
  lift: number,
  screen: number,
  overscan: number,
): Option.Option<LiftReach> => {
  const run = lastRunOf(rendered)

  return Option.map(
    Option.all({ first: Arr.head(run), last: Arr.last(run) }),
    ({ first, last }): LiftReach => {
      const shown = screen + lift
      const covered = last.end - first.start
      const from =
        covered >= shown
          ? Option.getOrElse(
              Option.map(
                Arr.findFirst(run, (row) => row.end > last.end - shown),
                (row) => row.index,
              ),
              () => first.index,
            )
          : Math.max(
              0,
              first.index - overscan - Math.ceil(((shown - covered) * run.length) / covered),
            )

      return { from, rendered: from >= first.index }
    },
  )
}

export const heldFrom = (held: Option.Option<number>, reach: LiftReach, overscan: number): number =>
  reach.rendered
    ? Option.match(held, {
        onNone: () => reach.from,
        onSome: (index) => Math.max(index, reach.from - overscan),
      })
    : reach.from
