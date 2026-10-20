import { RegistryProvider } from '@effect/atom-react/RegistryContext'
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router'
import { render } from '@testing-library/react'
import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import * as Atom from 'effect/reactivity/Atom'

import type { HerdView } from '@crook/domain/HerdView'
import { hubRuntime } from '@crook/web/atoms/Hub'
import { HerdSnapshot } from '@crook/web/cache/HerdCache'
import { remountWhenParamsChange } from '@crook/web/navigation/Pushed'
import { ROUTE_FALLBACKS } from '@crook/web/router/RouteFallbacks'
import { routeTree } from '@crook/web/routeTree.gen'
import { HubLinkState, LinkStatus } from '@crook/web/rpc/HubLinkState'

import { START } from './HerdFixtures.ts'
import { makeFakeHubLink } from './HubFakes.ts'

export const stateWith = (status: LinkStatus, view: Option.Option<HerdView>) =>
  new HubLinkState({
    status,
    herd: Option.map(view, (herd) => new HerdSnapshot({ view: herd, syncedAt: START })),
  })

export const liveWith = (view: HerdView) =>
  stateWith(LinkStatus.Live({ recovered: false }), Option.some(view))

export const renderApp = Effect.fn('renderApp')(function* (path: string, initial: HubLinkState) {
  const link = yield* makeFakeHubLink(initial)
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
    defaultRemountDeps: remountWhenParamsChange,
    ...ROUTE_FALLBACKS,
  })

  render(
    <RegistryProvider initialValues={[Atom.initialValue(hubRuntime.layer, link.layer)]}>
      <RouterProvider router={router} />
    </RegistryProvider>,
  )
  yield* Effect.promise(() => router.load())

  return { router, link }
})
