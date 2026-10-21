import { RegistryContext, RegistryProvider } from '@effect/atom-react/RegistryContext'
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router'
import { render } from '@testing-library/react'
import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import * as Atom from 'effect/reactivity/Atom'
import type * as AtomRegistry from 'effect/reactivity/AtomRegistry'
import * as React from 'react'

import type { HerdView } from '@crook/domain/HerdView'
import { hubRuntime } from '@crook/web/atoms/Hub'
import { HerdSnapshot } from '@crook/web/cache/HerdCache'
import { remountWhenParamsChange } from '@crook/web/navigation/Pushed'
import { ROUTE_FALLBACKS } from '@crook/web/router/RouteFallbacks'
import { routeTree } from '@crook/web/routeTree.gen'
import { HubLinkState, LinkStatus } from '@crook/web/rpc/HubLinkState'

import { START } from './HerdFixtures.ts'
import { present } from './Dom.ts'
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

  const registries: AtomRegistry.AtomRegistry[] = []

  render(
    <RegistryProvider initialValues={[Atom.initialValue(hubRuntime.layer, link.layer)]}>
      <RegistryHandle
        onRegistry={(registry) => {
          registries.push(registry)
        }}
      />
      <RouterProvider router={router} />
    </RegistryProvider>,
  )
  yield* Effect.promise(() => router.load())

  return { router, link, registry: present(registries[0], 'The atom registry') }
})

function RegistryHandle({
  onRegistry,
}: {
  onRegistry: (registry: AtomRegistry.AtomRegistry) => void
}) {
  onRegistry(React.useContext(RegistryContext))

  return null
}
