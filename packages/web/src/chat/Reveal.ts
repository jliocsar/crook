import * as Arr from 'effect/Array'
import { pipe } from 'effect/Function'

export interface RevealRow {
  readonly key: string
  readonly placeholder?: boolean
}

export interface RevealPlan {
  readonly placeholders: ReadonlySet<string>
  readonly departed: readonly string[]
}

export const EMPTY_REVEAL_PLAN: RevealPlan = {
  placeholders: new Set(),
  departed: [],
}

export const nextRevealPlan = (
  plan: RevealPlan,
  rows: readonly RevealRow[],
  options: { readonly animate: boolean },
): RevealPlan => {
  const keys = new Set(Arr.map(rows, (row) => row.key))

  return {
    placeholders: new Set(
      pipe(
        rows,
        Arr.filter((row) => row.placeholder === true),
        Arr.map((row) => row.key),
      ),
    ),
    departed: options.animate
      ? Arr.filter(Array.from(plan.placeholders), (key) => !keys.has(key))
      : [],
  }
}

export const liftFor = (grown: number, current: number, ceiling: number): number =>
  Math.max(0, Math.min(current + grown, ceiling))
