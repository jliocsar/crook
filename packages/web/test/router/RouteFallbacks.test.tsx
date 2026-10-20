import { describe, expect, it } from '@effect/vitest'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { render } from '@testing-library/react'
import * as Effect from 'effect/Effect'
import { beforeEach, vi } from 'vitest'

import { ROUTE_FALLBACKS } from '@crook/web/router/RouteFallbacks'
import { routeTree } from '@crook/web/routeTree.gen'

import { eventually, findByRole } from '../Dom.ts'
import { stubMediaQueries } from '../MediaQueries.ts'

const renderAt = Effect.fn('renderAt')(function* (
  tree: typeof routeTree | ReturnType<typeof brokenTree>,
  initialPath: string,
) {
  const router = createRouter({
    routeTree: tree,
    history: createMemoryHistory({ initialEntries: [initialPath] }),
    ...ROUTE_FALLBACKS,
  })

  render(<RouterProvider router={router} />)
  yield* Effect.promise(() => router.load())

  return router
})

const brokenTree = () => {
  const root = createRootRoute()
  const broken = createRoute({ getParentRoute: () => root, path: '/', component: Broken })

  return root.addChildren([broken])
}

function Broken(): never {
  throw new Error('The herd view failed to render.')
}

beforeEach(() => {
  stubMediaQueries(['(prefers-reduced-motion)'])
})

describe('route fallbacks', () => {
  it.effect('sends an unknown path home', () =>
    Effect.gen(function* () {
      const router = yield* renderAt(routeTree, '/nowhere')

      yield* eventually(() => {
        expect(router.state.location.pathname).toBe('/')
      })
    }),
  )

  it.effect('shows what broke, with a way to try again', () =>
    Effect.gen(function* () {
      vi.spyOn(console, 'error').mockImplementation(() => undefined)
      yield* renderAt(brokenTree(), '/')
      const alert = yield* findByRole('alert', '')

      expect(alert.textContent).toContain('The herd view failed to render.')
      expect(yield* findByRole('button', 'Try again')).not.toBeNull()
    }),
  )
})
