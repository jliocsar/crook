import * as Arr from 'effect/Array'
import { pipe } from 'effect/Function'
import * as Option from 'effect/Option'

export interface RowReveal {
  readonly enters: boolean
  readonly rise: boolean
  readonly delay: number
}

export interface RevealTiming {
  readonly step: number
  readonly spread: number
}

export interface RevealRow {
  readonly key: string
  readonly placeholder?: boolean
}

export interface RevealPlan {
  readonly keys: ReadonlySet<string>
  readonly placeholders: ReadonlySet<string>
  readonly reveals: ReadonlyMap<string, RowReveal>
  readonly departed: readonly string[]
}

export const STILL: RowReveal = { enters: false, rise: false, delay: 0 }

export const EMPTY_REVEAL_PLAN: RevealPlan = {
  keys: new Set(),
  placeholders: new Set(),
  reveals: new Map(),
  departed: [],
}

const isPlaceholder = (row: RevealRow): boolean => row.placeholder === true

export const staggerDelays = (count: number, timing: RevealTiming): readonly number[] => {
  if (count <= 0) {
    return []
  }

  const step = count === 1 ? 0 : Math.min(timing.step, timing.spread / (count - 1))

  return Arr.makeBy(count, (index) => index * step)
}

const freshTail = (plan: RevealPlan, rows: readonly RevealRow[]): readonly RevealRow[] =>
  pipe(
    Arr.findLastIndex(rows, (row) => plan.keys.has(row.key) && !isPlaceholder(row)),
    Option.match({ onNone: () => 0, onSome: (index) => index + 1 }),
    (from) => Arr.drop(rows, from),
    Arr.filter((row) => !plan.keys.has(row.key)),
  )

const revealsOf = (
  fresh: readonly RevealRow[],
  takesOver: boolean,
  timing: RevealTiming,
): ReadonlyMap<string, RowReveal> =>
  new Map(
    pipe(
      Arr.zip(fresh, staggerDelays(fresh.length, timing)),
      Arr.map(([row, delay], index): readonly [string, RowReveal] => [
        row.key,
        { enters: true, rise: !(takesOver && index === 0), delay },
      ]),
    ),
  )

export const nextRevealPlan = (
  plan: RevealPlan,
  rows: readonly RevealRow[],
  options: { readonly animate: boolean; readonly timing: RevealTiming },
): RevealPlan => {
  const keys = new Set(Arr.map(rows, (row) => row.key))
  const departed = options.animate
    ? Arr.filter(Array.from(plan.placeholders), (key) => !keys.has(key))
    : []
  const fresh = options.animate ? freshTail(plan, rows) : []

  return {
    keys,
    placeholders: new Set(
      pipe(
        rows,
        Arr.filter(isPlaceholder),
        Arr.map((row) => row.key),
      ),
    ),
    reveals: revealsOf(fresh, departed.length > 0, options.timing),
    departed,
  }
}

export const revealOf = (plan: RevealPlan, key: string): RowReveal => plan.reveals.get(key) ?? STILL

export const withoutReveal = (plan: RevealPlan, key: string): RevealPlan => {
  if (!plan.reveals.has(key)) {
    return plan
  }

  return {
    ...plan,
    reveals: new Map(Arr.filter(Array.from(plan.reveals), ([planned]) => planned !== key)),
  }
}

export const liftFor = (grown: number, current: number, ceiling: number): number =>
  Math.max(0, Math.min(current + grown, ceiling))
