import { RegistryContext, scheduleTask } from '@effect/atom-react/RegistryContext'
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router'
import type * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Atom from 'effect/reactivity/Atom'
import * as AtomRegistry from 'effect/reactivity/AtomRegistry'
import * as Ref from 'effect/Ref'
import * as Schema from 'effect/Schema'

import type { HerdView } from '@crook/domain/HerdView'
import { OpenedTimes } from '@crook/domain/OpenedTimes'
import { hubRuntime } from '@crook/web/atoms/Hub'
import { openedRuntime } from '@crook/web/atoms/Opened'
import type { DraftCache } from '@crook/web/cache/DraftCache'
import { HerdSnapshot } from '@crook/web/cache/HerdCache'
import { OpenedAgents } from '@crook/web/cache/OpenedAgents'
import type { OpenedStore } from '@crook/web/cache/OpenedAgents'
import type { TranscriptCache } from '@crook/web/cache/TranscriptCache'
import { remountWhenParamsChange } from '@crook/web/navigation/Pushed'
import { ROUTE_FALLBACKS } from '@crook/web/router/RouteFallbacks'
import { routeTree } from '@crook/web/routeTree.gen'
import type { HubLink } from '@crook/web/rpc/HubLink'
import type { HubUploads } from '@crook/web/rpc/HubUploads'
import { HubLinkState, LIVE } from '@crook/web/rpc/HubLinkState'
import type { LinkStatus } from '@crook/web/rpc/HubLinkState'

import { START } from './HerdFixtures.ts'

export interface PhoneMarks {
  readonly opened?: OpenedTimes
}

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

export const memoryOpenedStore = (opened: OpenedTimes = {}): OpenedStore => {
  const stored = Ref.makeUnsafe<unknown>(Schema.encodeSync(OpenedTimes)(opened))

  return {
    read: Ref.get(stored),
    write: (encoded) => Ref.set(stored, encoded),
  }
}

export const appRegistry = (
  hub: Layer.Layer<HubLink | TranscriptCache | HubUploads | DraftCache>,
  marks: PhoneMarks = {},
) =>
  AtomRegistry.make({
    initialValues: [
      Atom.initialValue(hubRuntime.layer, hub),
      Atom.initialValue(
        openedRuntime.layer,
        OpenedAgents.layerOver(memoryOpenedStore(marks.opened)),
      ),
    ],
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
