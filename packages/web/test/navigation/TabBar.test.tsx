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

import { TabBar } from '@crook/web/navigation/TabBar'

import { click, findByRole } from '../Dom.ts'

const renderTabBar = Effect.fn('renderTabBar')(function* (needsYou: number) {
  const root = createRootRoute({
    component: () => (
      <>
        <Outlet />
        <TabBar needsYou={needsYou} />
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

  render(<RouterProvider router={router} />)
  yield* Effect.promise(() => router.load())

  return router
})

describe('TabBar', () => {
  it.effect('marks the current tab and switches without adding history', () =>
    Effect.gen(function* () {
      const router = yield* renderTabBar(0)

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
      yield* renderTabBar(2)
      const agents = yield* findByRole('link', 'Agents , 2 need you')

      expect(agents.querySelector('[aria-hidden="true"].bg-primary')?.textContent).toBe('2')
    }),
  )

  it.effect('shows no count when nothing needs you', () =>
    Effect.gen(function* () {
      yield* renderTabBar(0)
      const agents = yield* findByRole('link', 'Agents')

      expect(agents.querySelector('.bg-primary')).toBeNull()
    }),
  )
})
