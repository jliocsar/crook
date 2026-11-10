import { RegistryProvider } from '@effect/atom-react/RegistryContext'
import { describe, expect, it } from '@effect/vitest'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
  useMatch,
  useRouter,
} from '@tanstack/react-router'
import { fireEvent, render, screen } from '@testing-library/react'
import * as Effect from 'effect/Effect'
import * as Atom from 'effect/reactivity/Atom'
import { beforeEach } from 'vitest'

import { hubRuntime } from '@crook/web/atoms/Hub'
import { openedFrom } from '@crook/web/navigation/Opener'
import { remountWhenParamsChange } from '@crook/web/navigation/Pushed'
import { PushedHeader, PushedScreen } from '@crook/web/navigation/PushedScreen'
import { Shell } from '@crook/web/navigation/Shell'
import { TabScreen } from '@crook/web/navigation/TabScreen'

import { liveWith } from '../AppRender.tsx'
import { afterSpring, click, eventually, findByRole, springSettles } from '../Dom.ts'
import { herd } from '../HerdFixtures.ts'
import { makeFakeHubLink } from '../HubFakes.ts'
import { stubMediaQueries } from '../MediaQueries.ts'

const makeRouter = (initialEntries: string[]) => {
  const root = createRootRoute({ component: () => <Shell /> })
  const agents = createRoute({ getParentRoute: () => root, id: 'agents', component: Agents })
  const agentsIndex = createRoute({ getParentRoute: () => agents, path: '/' })
  const detail = createRoute({
    getParentRoute: () => agents,
    path: '/detail',
    staticData: { pushed: true },
    component: Detail,
  })
  const loading = createRoute({
    getParentRoute: () => detail,
    path: 'loading',
    staticData: { pushed: true },
    loader: () => Effect.runPromise(Effect.never),
    component: Loading,
  })
  const item = createRoute({
    getParentRoute: () => agents,
    path: '/item/$itemId',
    staticData: { pushed: true },
    component: Item,
  })
  const machines = createRoute({
    getParentRoute: () => root,
    path: '/machines',
    component: () => <TabScreen title="Machines" />,
  })

  return createRouter({
    routeTree: root.addChildren([
      agents.addChildren([agentsIndex, detail.addChildren([loading]), item]),
      machines,
    ]),
    history: createMemoryHistory({ initialEntries }),
    defaultRemountDeps: remountWhenParamsChange,
  })
}

const renderAt = Effect.fn('renderAt')(function* (initialEntries: string[]) {
  const router = makeRouter(initialEntries)

  const link = yield* makeFakeHubLink(liveWith(herd([])))

  render(
    <RegistryProvider initialValues={[Atom.initialValue(hubRuntime.layer, link.layer)]}>
      <RouterProvider router={router} />
    </RegistryProvider>,
  )
  yield* Effect.promise(() => router.load())

  return router
})

const pushedScreen = () => document.querySelector<HTMLElement>('[data-slot="pushed-screen"]')

const edgeOf = (): Element => {
  const edge = document.querySelector('[data-slot="edge-back"]')

  expect(edge).not.toBeNull()

  return edge ?? document.body
}

const afterSpringFind = Effect.fn('afterSpringFind')(function* (name: string) {
  yield* afterSpring(() => {
    expect(screen.getByRole('heading', { name })).toBeDefined()
  })

  return screen.getByRole('heading', { name })
})

const FAR_PAST_THE_LEFT_EDGE = -1000

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
      <button
        type="button"
        onClick={(event) => {
          router.history.push('/item/1', openedFrom(event.currentTarget))
        }}
      >
        Open item 1
      </button>
    </TabScreen>
  )
}

function Detail() {
  return (
    <>
      <PushedScreen>
        <PushedHeader title="Detail" backLabel="Back to agents" />
      </PushedScreen>
      <Outlet />
    </>
  )
}

function Loading() {
  return (
    <PushedScreen>
      <PushedHeader title="Loading" backLabel="Back to detail" />
    </PushedScreen>
  )
}

function Item() {
  const router = useRouter()
  const pathname = useMatch({ strict: false, select: (match) => match.pathname })

  return (
    <PushedScreen>
      <PushedHeader title={`Item ${pathname.slice('/item/'.length)}`} backLabel="Back to agents" />
      <button
        type="button"
        onClick={(event) => {
          router.history.push('/item/2', openedFrom(event.currentTarget))
        }}
      >
        Open item 2
      </button>
    </PushedScreen>
  )
}

beforeEach(() => {
  stubMediaQueries([])
})

describe('PushedScreen with motion', () => {
  it.effect('slides in, focuses its title on arrival, and slides out before leaving', () =>
    Effect.gen(function* () {
      const router = yield* renderAt(['/'])
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

  it.effect('stops the slide-in when the edge is grabbed, and still focuses the title', () =>
    Effect.gen(function* () {
      const router = yield* renderAt(['/'])

      yield* click(yield* findByRole('button', 'Open detail'))
      const title = yield* findByRole('heading', 'Detail')
      const edge = edgeOf()

      fireEvent.pointerDown(edge, { clientX: 0, pointerId: 1 })

      expect(document.activeElement).toBe(title)

      fireEvent.pointerMove(edge, { clientX: FAR_PAST_THE_LEFT_EDGE, pointerId: 1 })
      fireEvent.pointerUp(edge, { clientX: FAR_PAST_THE_LEFT_EDGE, pointerId: 1 })
      yield* afterSpring(() => {
        expect(pushedScreen()?.style.transform).toBe('none')
      })

      expect(router.state.location.pathname).toBe('/detail')
      expect(document.activeElement).toBe(title)
    }),
  )

  it.effect('leaves only once when its entry is popped during the slide-out', () =>
    Effect.gen(function* () {
      const router = yield* renderAt(['/machines', '/'])

      yield* click(yield* findByRole('button', 'Open detail'))
      const title = yield* findByRole('heading', 'Detail')

      yield* afterSpring(() => {
        expect(document.activeElement).toBe(title)
      })
      yield* click(yield* findByRole('button', 'Back to agents'))
      router.history.back()
      yield* eventually(() => {
        expect(router.state.location.pathname).toBe('/')
      })
      yield* springSettles

      expect(router.state.location.pathname).toBe('/')
    }),
  )

  it.effect('cancels a push that is still loading when Back is tapped beneath it', () =>
    Effect.gen(function* () {
      const router = yield* renderAt(['/'])

      yield* click(yield* findByRole('button', 'Open detail'))
      const title = yield* findByRole('heading', 'Detail')

      yield* afterSpring(() => {
        expect(document.activeElement).toBe(title)
      })
      router.history.push('/detail/loading')
      yield* eventually(() => {
        expect(router.state.status).toBe('pending')
      })
      yield* click(yield* findByRole('button', 'Back to agents'))
      yield* eventually(() => {
        expect(router.state.location.pathname).toBe('/detail')
        expect(router.state.status).toBe('idle')
      })

      expect(pushedScreen()).toHaveProperty('inert', false)
      expect(pushedScreen()?.style.transform).toBe('none')

      yield* click(yield* findByRole('button', 'Back to agents'))
      yield* afterSpring(() => {
        expect(router.state.location.pathname).toBe('/')
      })
    }),
  )

  it.effect('shows a screen that replaces another in place', () =>
    Effect.gen(function* () {
      const router = yield* renderAt(['/'])

      yield* click(yield* findByRole('button', 'Open item 1'))
      const firstTitle = yield* findByRole('heading', 'Item 1')

      yield* afterSpring(() => {
        expect(document.activeElement).toBe(firstTitle)
      })
      void router.navigate({ href: '/item/2', replace: true })
      const secondTitle = yield* findByRole('heading', 'Item 2')

      expect(pushedScreen()?.style.transform).toBe('none')
      expect(document.activeElement).toBe(secondTitle)
    }),
  )

  it.effect('reveals an earlier screen in place when Back remounts it', () =>
    Effect.gen(function* () {
      const router = yield* renderAt(['/'])

      yield* click(yield* findByRole('button', 'Open item 1'))
      const firstTitle = yield* findByRole('heading', 'Item 1')

      yield* afterSpring(() => {
        expect(document.activeElement).toBe(firstTitle)
      })
      yield* click(yield* findByRole('button', 'Open item 2'))
      const secondTitle = yield* findByRole('heading', 'Item 2')

      yield* afterSpring(() => {
        expect(document.activeElement).toBe(secondTitle)
      })
      yield* click(yield* findByRole('button', 'Back to agents'))
      const returnedTitle = yield* afterSpringFind('Item 1')

      expect(router.state.location.pathname).toBe('/item/1')
      expect(pushedScreen()?.style.transform).toBe('none')
      expect(document.activeElement).toBe(returnedTitle)
    }),
  )
})
