import { describe, expect, it } from '@effect/vitest'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
  useRouter,
} from '@tanstack/react-router'
import { render, screen } from '@testing-library/react'
import * as Effect from 'effect/Effect'
import { beforeEach } from 'vitest'

import { openedFrom } from '@crook/web/navigation/Opener'
import { PushedHeader, PushedScreen } from '@crook/web/navigation/PushedScreen'
import { Shell } from '@crook/web/navigation/Shell'
import { TabScreen } from '@crook/web/navigation/TabScreen'

import { afterSpring, click, findByRole } from '../Dom.ts'
import { stubMediaQueries } from '../MediaQueries.ts'

const makeRouter = () => {
  const root = createRootRoute({ component: Shell })
  const agents = createRoute({ getParentRoute: () => root, id: 'agents', component: Agents })
  const agentsIndex = createRoute({ getParentRoute: () => agents, path: '/' })
  const detail = createRoute({
    getParentRoute: () => agents,
    path: '/detail',
    staticData: { pushed: true },
    component: Detail,
  })

  return createRouter({
    routeTree: root.addChildren([agents.addChildren([agentsIndex, detail])]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
}

const pushedScreen = () => document.querySelector<HTMLElement>('[data-slot="pushed-screen"]')

function Agents() {
  const router = useRouter()

  return (
    <TabScreen title="crook">
      <button
        type="button"
        onClick={(event) => {
          router.history.push('/detail', openedFrom(event.currentTarget))
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
  stubMediaQueries([])
})

describe('PushedScreen with motion', () => {
  it.effect('slides in, focuses its title on arrival, and slides out before leaving', () =>
    Effect.gen(function* () {
      const router = makeRouter()

      render(<RouterProvider router={router} />)
      yield* Effect.promise(() => router.load())
      const opener = yield* findByRole('button', 'Open detail')

      yield* click(opener)
      const title = yield* findByRole('heading', 'Detail')

      expect(document.activeElement).not.toBe(title)

      yield* afterSpring(() => {
        expect(document.activeElement).toBe(title)
      })

      expect(pushedScreen()?.style.transform).toBe('none')

      yield* click(yield* findByRole('button', 'Back to agents'))

      expect(router.state.location.pathname).toBe('/detail')

      yield* afterSpring(() => {
        expect(router.state.location.pathname).toBe('/')
      })

      expect(screen.queryByRole('heading', { name: 'Detail' })).toBeNull()
      expect(document.activeElement).toBe(opener)
    }),
  )
})
