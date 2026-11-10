import * as Option from 'effect/Option'
import * as React from 'react'

export type CodeRenderer = (code: string, language: Option.Option<string>) => React.ReactNode

type RenderSource = CodeRenderer | undefined

export class RenderedNode {
  readonly node: React.ReactNode
  readonly source: RenderSource

  constructor(node: React.ReactNode, source: RenderSource) {
    this.node = node
    this.source = source
  }
}

export class RenderedLines {
  readonly lines: readonly React.ReactNode[]

  constructor(lines: readonly React.ReactNode[]) {
    this.lines = lines
  }
}

const RenderCacheContext = React.createContext<Option.Option<Map<string, unknown>>>(Option.none())

export const useRenderCache = (): Option.Option<Map<string, unknown>> =>
  React.useContext(RenderCacheContext)

export const recallNode = (
  cache: Option.Option<Map<string, unknown>>,
  key: string,
  source: RenderSource,
): Option.Option<React.ReactNode> =>
  Option.flatMap(cache, (store) => {
    const found = store.get(key)

    return found instanceof RenderedNode && found.source === source
      ? Option.some(found.node)
      : Option.none()
  })

export const recallLines = (
  cache: Option.Option<Map<string, unknown>>,
  key: string,
): Option.Option<readonly React.ReactNode[]> =>
  Option.flatMap(cache, (store) => {
    const found = store.get(key)

    return found instanceof RenderedLines ? Option.some(found.lines) : Option.none()
  })

export const remember = (
  cache: Option.Option<Map<string, unknown>>,
  key: string,
  value: RenderedNode | RenderedLines,
): void => {
  if (Option.isSome(cache)) {
    cache.value.set(key, value)
  }
}

export function RenderCacheScope({ children }: { children: React.ReactNode }) {
  const [store] = React.useState(() => Option.some(new Map<string, unknown>()))

  return <RenderCacheContext.Provider value={store}>{children}</RenderCacheContext.Provider>
}
