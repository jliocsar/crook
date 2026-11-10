import { RegistryContext, scheduleTask } from '@effect/atom-react/RegistryContext'
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router'
import type * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Atom from 'effect/reactivity/Atom'
import * as AtomRegistry from 'effect/reactivity/AtomRegistry'

import type { HerdView } from '@crook/domain/HerdView'
import { hubRuntime } from '@crook/web/atoms/Hub'
import { HerdSnapshot } from '@crook/web/cache/HerdCache'
import type { TranscriptCache } from '@crook/web/cache/TranscriptCache'
import { remountWhenParamsChange } from '@crook/web/navigation/Pushed'
import { ROUTE_FALLBACKS } from '@crook/web/router/RouteFallbacks'
import { routeTree } from '@crook/web/routeTree.gen'
import type { HubLink } from '@crook/web/rpc/HubLink'
import { HubLinkState, LIVE } from '@crook/web/rpc/HubLinkState'
import type { LinkStatus } from '@crook/web/rpc/HubLinkState'

import { START } from './HerdFixtures.ts'

export const stateWith = (status: LinkStatus, view: Option.Option<HerdView>) =>
  new HubLinkState({
    status,
    herd: Option.map(view, (herd) => new HerdSnapshot({ view: herd, syncedAt: START })),
  })

export const liveWith = (view: HerdView) => stateWith(LIVE, Option.some(view))

export const appRouter = (path: string) =>
  createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
    defaultRemountDeps: remountWhenParamsChange,
    ...ROUTE_FALLBACKS,
  })

export const appRegistry = (hub: Layer.Layer<HubLink | TranscriptCache>) =>
  AtomRegistry.make({
    initialValues: [Atom.initialValue(hubRuntime.layer, hub)],
    scheduleTask,
  })

export function AppTree({
  registry,
  router,
}: {
  registry: AtomRegistry.AtomRegistry
  router: ReturnType<typeof appRouter>
}) {
  return (
    <RegistryContext value={registry}>
      <RouterProvider router={router} />
    </RegistryContext>
  )
}
