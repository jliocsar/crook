import { render } from '@testing-library/react'
import * as Effect from 'effect/Effect'

import type { HubLinkState } from '@crook/web/rpc/HubLinkState'

import { appRegistry, appRouter, AppTree } from './AppWiring.tsx'
import { makeFakeHubLink } from './HubFakes.ts'

export const renderApp = Effect.fn('renderApp')(function* (path: string, initial: HubLinkState) {
  const link = yield* makeFakeHubLink(initial)
  const router = appRouter(path)
  const { registry } = yield* Effect.acquireRelease(
    Effect.sync(() => {
      const made = appRegistry(link.layer)
      const rendered = render(<AppTree registry={made} router={router} />)

      return { registry: made, rendered }
    }),
    ({ registry: made, rendered }) =>
      Effect.sync(() => {
        rendered.unmount()
        made.dispose()
      }),
  )

  yield* Effect.promise(() => router.load())

  return { router, link, registry }
})

export { liveWith, stateWith } from './AppWiring.tsx'
