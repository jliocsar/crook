import type { HistoryState } from '@tanstack/history'
import * as Option from 'effect/Option'

const openers = new Map<string, HTMLElement>()

export const openedFrom = (opener: HTMLElement): HistoryState => {
  const openerKey = String(openersMade)

  openersMade += 1
  openers.set(openerKey, opener)

  return { openerKey }
}

export const findOpener = (openerKey: string | undefined): Option.Option<HTMLElement> =>
  Option.flatMap(Option.fromUndefinedOr(openerKey), (key) =>
    Option.fromUndefinedOr(openers.get(key)),
  )

export const forgetOpener = (openerKey: string | undefined): void => {
  if (openerKey !== undefined) {
    openers.delete(openerKey)
  }
}

let openersMade = 0

declare module '@tanstack/history' {
  interface HistoryState {
    readonly openerKey?: string
  }
}
