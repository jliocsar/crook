import type { HistoryState } from '@tanstack/history'
import { pipe } from 'effect/Function'
import * as Option from 'effect/Option'

const openers = new Map<string, WeakRef<HTMLElement>>()

const openerKeys = new WeakMap<HTMLElement, string>()

const registerOpener = (opener: HTMLElement): string => {
  const openerKey = `${performance.timeOrigin}:${openers.size}`

  openers.set(openerKey, new WeakRef(opener))
  openerKeys.set(opener, openerKey)

  return openerKey
}

export const openedFrom = (opener: HTMLElement): HistoryState => ({
  openerKey: openerKeys.get(opener) ?? registerOpener(opener),
})

export const carriedOpener = ({ openerKey }: HistoryState): HistoryState =>
  openerKey === undefined ? {} : { openerKey }

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
