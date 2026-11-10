import { useRouter } from '@tanstack/react-router'
import type { HistoryState } from '@tanstack/history'
import * as React from 'react'

import { openedFrom } from '@crook/web/navigation/Opener'

export const openedFromMachine = (opener: HTMLElement): HistoryState => ({
  ...openedFrom(opener),
  openedFromMachine: true,
})

export const carriedOrigin = ({ openerKey, openedFromMachine: fromMachine }: HistoryState) => {
  const opener: HistoryState = openerKey === undefined ? {} : { openerKey }

  return fromMachine === true ? { ...opener, openedFromMachine: true } : opener
}

export const useOpenedFromMachine = (): boolean => {
  const router = useRouter()
  const [fromMachine] = React.useState(() => router.state.location.state.openedFromMachine === true)

  return fromMachine
}

declare module '@tanstack/history' {
  interface HistoryState {
    readonly openedFromMachine?: boolean
  }
}
