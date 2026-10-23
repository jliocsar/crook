import { RegistryProvider } from '@effect/atom-react/RegistryContext'
import { describe, expect, it } from '@effect/vitest'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router'
import { render, screen } from '@testing-library/react'
import * as Effect from 'effect/Effect'
import * as Atom from 'effect/reactivity/Atom'

import type { HerdView } from '@crook/domain/HerdView'
import { hubRuntime } from '@crook/web/atoms/Hub'
import { TabBar } from '@crook/web/navigation/TabBar'

import { liveWith } from '../AppRender.tsx'
import { click, findByRole } from '../Dom.ts'
import { agent, herd, LAPTOP, machine } from '../HerdFixtures.ts'
import { makeFakeHubLink } from '../HubFakes.ts'

const renderTabBar = Effect.fn('renderTabBar')(function* (view: HerdView) {
  const root = createRootRoute({
    component: () => (
      <>
        <Outlet />
        <TabBar />
      </>
    ),
  })
  const tabs = ['/', '/machines', '/settings'].map((path) =>
    createRoute({ getParentRoute: () => root, path }),
  )
  const router = createRouter({
    routeTree: root.addChildren(tabs),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })

  const link = yield* makeFakeHubLink(liveWith(view))

  render(
    <RegistryProvider initialValues={[Atom.initialValue(hubRuntime.layer, link.layer)]}>
      <RouterProvider router={router} />
    </RegistryProvider>,
  )
  yield* Effect.promise(() => router.load())

  return router
})

describe('TabBar', () => {
  it.effect('marks the current tab and switches without adding history', () =>
    Effect.gen(function* () {
      const router = yield* renderTabBar(herd([]))

      yield* click(yield* findByRole('link', 'Machines'))

      expect(screen.getByRole('link', { name: 'Machines' }).getAttribute('aria-current')).toBe(
        'page',
      )
      expect(screen.getByRole('link', { name: 'Agents' }).getAttribute('aria-current')).toBeNull()
      expect(router.history.canGoBack()).toBe(false)
    }),
  )

  it.effect('shows the needs-you count and says it to screen readers', () =>
    Effect.gen(function* () {
      yield* renderTabBar(
        herd([machine(LAPTOP, [agent('w1:p1', 'blocked'), agent('w1:p2', 'blocked')])]),
      )
      const agents = yield* findByRole('link', 'Agents , 2 need you')

      expect(agents.querySelector('[aria-hidden="true"].bg-primary')?.textContent).toBe('2')
    }),
  )

  it.effect('shows no count when nothing needs you', () =>
    Effect.gen(function* () {
      yield* renderTabBar(herd([]))
      const agents = yield* findByRole('link', 'Agents')

      expect(agents.querySelector('.bg-primary')).toBeNull()
    }),
  )
})
