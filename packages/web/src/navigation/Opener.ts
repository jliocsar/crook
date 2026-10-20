import type { HistoryState } from '@tanstack/history'
import { pipe } from 'effect/Function'
import * as Option from 'effect/Option'

const openers = new Map<string, WeakRef<HTMLElement>>()

export const openedFrom = (opener: HTMLElement): HistoryState => {
  const openerKey = String(openers.size)

  openers.set(openerKey, new WeakRef(opener))

  return { openerKey }
}

export const findOpener = (openerKey: string | undefined): Option.Option<HTMLElement> =>
  pipe(
    Option.fromUndefinedOr(openerKey),
    Option.flatMap((key) => Option.fromUndefinedOr(openers.get(key))),
    Option.flatMap((opener) => Option.fromUndefinedOr(opener.deref())),
  )

declare module '@tanstack/history' {
  interface HistoryState {
    readonly openerKey?: string
  }
}
