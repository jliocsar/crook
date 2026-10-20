import { useChildMatches, useMatches } from '@tanstack/react-router'

type WithStaticData = { readonly staticData: { readonly pushed?: boolean } }

const anyPushed = (matches: readonly WithStaticData[]): boolean =>
  matches.some((match) => match.staticData.pushed === true)

export const useAnyScreenPushed = (): boolean => useMatches({ select: anyPushed })

export const useCoveredByPushedScreen = (): boolean => useChildMatches({ select: anyPushed })

declare module '@tanstack/react-router' {
  interface StaticDataRouteOption {
    readonly pushed?: boolean
  }
}
