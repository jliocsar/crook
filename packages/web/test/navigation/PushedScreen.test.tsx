import { describe, expect, it } from '@effect/vitest'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
  useRouter,
} from '@tanstack/react-router'
import { fireEvent, render, screen } from '@testing-library/react'
import * as Effect from 'effect/Effect'
import { beforeEach } from 'vitest'

import { PushedHeader, PushedScreen } from '@/navigation/PushedScreen'
import { Shell } from '@/navigation/Shell'
import { TabScreen } from '@/navigation/TabScreen'

import { click, eventually, findByRole } from '../Dom.ts'
import { stubMediaQueries } from '../MediaQueries.ts'

const makeRouter = (initialPath: string) => {
  const root = createRootRoute({ component: Shell })
  const agents = createRoute({ getParentRoute: () => root, id: 'agents', component: Agents })
  const agentsIndex = createRoute({ getParentRoute: () => agents, path: '/' })
  const detail = createRoute({
    getParentRoute: () => agents,
    path: '/detail',
    staticData: { pushed: true },
    component: Detail,
  })
  const machines = createRoute({
    getParentRoute: () => root,
    path: '/machines',
    component: () => <TabScreen title="Machines" />,
  })
  const settings = createRoute({
    getParentRoute: () => root,
    path: '/settings',
    component: () => <TabScreen title="Settings" />,
  })

  return createRouter({
    routeTree: root.addChildren([agents.addChildren([agentsIndex, detail]), machines, settings]),
    history: createMemoryHistory({ initialEntries: [initialPath] }),
  })
}

const renderAt = Effect.fn('renderAt')(function* (initialPath: string) {
  const router = makeRouter(initialPath)

  render(<RouterProvider router={router} />)
  yield* Effect.promise(() => router.load())

  return router
})

function Agents() {
  const router = useRouter()

  return (
    <TabScreen title="crook">
      <button
        type="button"
        onClick={() => {
          router.history.push('/detail')
        }}
      >
        Open detail
      </button>
    </TabScreen>
  )
}

function Detail() {
  return (
    <PushedScreen>
      <PushedHeader title="Detail" backLabel="Back to agents" />
    </PushedScreen>
  )
}

beforeEach(() => {
  stubMediaQueries(['(prefers-reduced-motion)'])
})

describe('PushedScreen', () => {
  it.effect('moves focus to its title and covers the tab bar and the screen below', () =>
    Effect.gen(function* () {
      yield* renderAt('/')
      yield* click(yield* findByRole('button', 'Open detail'))
      const title = yield* findByRole('heading', 'Detail')

      yield* eventually(() => {
        expect(document.activeElement).toBe(title)
      })

      expect(screen.getByRole('navigation', { name: 'Sections', hidden: true })).toHaveProperty(
        'inert',
        true,
      )
      expect(
        screen.getByRole('heading', { name: 'crook', hidden: true }).closest('[inert]'),
      ).not.toBeNull()
    }),
  )

  it.effect('goes back through history and returns focus to the opener', () =>
    Effect.gen(function* () {
      const router = yield* renderAt('/')
      const opener = yield* findByRole('button', 'Open detail')

      yield* click(opener)
      yield* click(yield* findByRole('button', 'Back to agents'))
      yield* eventually(() => {
        expect(screen.queryByRole('heading', { name: 'Detail' })).toBeNull()
      })

      expect(router.state.location.pathname).toBe('/')
      expect(document.activeElement).toBe(opener)
      expect(screen.getByRole('navigation', { name: 'Sections' })).toHaveProperty('inert', false)
    }),
  )

  it.effect('replaces itself with its parent when there is no history to go back to', () =>
    Effect.gen(function* () {
      const router = yield* renderAt('/detail')

      yield* click(yield* findByRole('button', 'Back to agents'))
      yield* eventually(() => {
        expect(router.state.location.pathname).toBe('/')
      })

      expect(router.history.canGoBack()).toBe(false)
      expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Agents' }))
    }),
  )

  it.effect('goes back when the edge swipe passes a third of the width', () =>
    Effect.gen(function* () {
      const router = yield* renderAt('/')

      yield* click(yield* findByRole('button', 'Open detail'))
      const edge = document.querySelector('[data-slot="edge-back"]')

      expect(edge).not.toBeNull()

      if (edge !== null) {
        fireEvent.pointerDown(edge, { clientX: 0, pointerId: 1 })
        fireEvent.pointerMove(edge, { clientX: 200, pointerId: 1 })
        fireEvent.pointerUp(edge, { clientX: 200, pointerId: 1 })
      }

      yield* eventually(() => {
        expect(router.state.location.pathname).toBe('/')
      })
    }),
  )
})
