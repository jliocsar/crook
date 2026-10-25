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
import { afterEach, beforeEach, vi } from 'vitest'

import { hubRuntime } from '@crook/web/atoms/Hub'
import { openedFrom } from '@crook/web/navigation/Opener'
import { remountWhenParamsChange } from '@crook/web/navigation/Pushed'
import { PushedHeader, PushedScreen } from '@crook/web/navigation/PushedScreen'
import { Shell } from '@crook/web/navigation/Shell'
import { TabScreen } from '@crook/web/navigation/TabScreen'

import { liveWith } from '../AppRender.tsx'
import { click, eventually, findByRole, wait } from '../Dom.ts'
import { herd } from '../HerdFixtures.ts'
import { makeFakeHubLink } from '../HubFakes.ts'
import { stubMediaQueries } from '../MediaQueries.ts'
import {
  emulateVisualViewport,
  forgetVisualViewport,
  moveVisualViewport,
} from '../VisualViewport.ts'

const makeRouter = (initialPath: string) => {
  const root = createRootRoute({ component: () => <Shell /> })
  const agents = createRoute({ getParentRoute: () => root, id: 'agents', component: Agents })
  const agentsIndex = createRoute({ getParentRoute: () => agents, path: '/' })
  const detail = createRoute({
    getParentRoute: () => agents,
    path: '/detail',
    staticData: { pushed: true },
    component: Detail,
  })
  const more = createRoute({
    getParentRoute: () => detail,
    path: 'more',
    staticData: { pushed: true },
    component: More,
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
  const settings = createRoute({
    getParentRoute: () => root,
    path: '/settings',
    component: () => <TabScreen title="Settings" />,
  })

  return createRouter({
    routeTree: root.addChildren([
      agents.addChildren([agentsIndex, detail.addChildren([more]), item]),
      machines,
      settings,
    ]),
    history: createMemoryHistory({ initialEntries: [initialPath] }),
    defaultRemountDeps: remountWhenParamsChange,
  })
}

const renderAt = Effect.fn('renderAt')(function* (initialPath: string) {
  const router = makeRouter(initialPath)

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
      <button
        type="button"
        onClick={(event) => {
          router.history.push('/detail', openedFrom(event.currentTarget))
        }}
      >
        Open detail from a tap
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
  const router = useRouter()

  return (
    <>
      <PushedScreen>
        <PushedHeader title="Detail" backLabel="Back to agents" />
        <button
          type="button"
          onClick={(event) => {
            router.history.push('/detail/more', openedFrom(event.currentTarget))
          }}
        >
          Open more
        </button>
      </PushedScreen>
      <Outlet />
    </>
  )
}

function More() {
  return (
    <PushedScreen>
      <PushedHeader title="More" backLabel="Back to detail" />
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
  stubMediaQueries(['(prefers-reduced-motion)'])
})

afterEach(() => {
  forgetVisualViewport()
  Reflect.deleteProperty(window, 'scrollY')
  vi.restoreAllMocks()
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

  it.effect('returns focus to the opener a tap never focused, as WebKit taps do', () =>
    Effect.gen(function* () {
      yield* renderAt('/')
      const opener = yield* findByRole('button', 'Open detail from a tap')

      fireEvent.click(opener)
      const title = yield* findByRole('heading', 'Detail')

      yield* eventually(() => {
        expect(document.activeElement).toBe(title)
      })
      yield* click(yield* findByRole('button', 'Back to agents'))
      yield* eventually(() => {
        expect(screen.queryByRole('heading', { name: 'Detail' })).toBeNull()
      })

      expect(document.activeElement).toBe(opener)
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

  it.effect('stays when a drag in the edge gutter starts vertically', () =>
    Effect.gen(function* () {
      const router = yield* renderAt('/')

      yield* click(yield* findByRole('button', 'Open detail'))
      const edge = document.querySelector('[data-slot="edge-back"]')
      const pushed = document.querySelector('[data-slot="pushed-screen"]')

      expect(edge).not.toBeNull()

      if (edge !== null) {
        fireEvent.pointerDown(edge, { clientX: 0, clientY: 300, pointerId: 1 })
        fireEvent.pointerMove(edge, { clientX: 4, clientY: 320, pointerId: 1 })
        fireEvent.pointerMove(edge, { clientX: 200, clientY: 340, pointerId: 1 })

        expect(pushed).toHaveProperty('style.transform', 'none')

        fireEvent.pointerUp(edge, { clientX: 200, clientY: 340, pointerId: 1 })
      }

      yield* wait(50)

      expect(router.state.location.pathname).not.toBe('/')
    }),
  )

  it.effect('gives other params their own screen, and Back lands on a usable earlier one', () =>
    Effect.gen(function* () {
      const router = yield* renderAt('/')
      const opener = yield* findByRole('button', 'Open item 1')

      fireEvent.click(opener)
      const firstTitle = yield* findByRole('heading', 'Item 1')

      yield* eventually(() => {
        expect(document.activeElement).toBe(firstTitle)
      })
      fireEvent.click(yield* findByRole('button', 'Open item 2'))
      const secondTitle = yield* findByRole('heading', 'Item 2')

      yield* eventually(() => {
        expect(document.activeElement).toBe(secondTitle)
      })
      yield* click(yield* findByRole('button', 'Back to agents'))
      const returnedTitle = yield* findByRole('heading', 'Item 1')

      yield* eventually(() => {
        expect(document.activeElement).toBe(returnedTitle)
      })

      expect(router.state.location.pathname).toBe('/item/1')
      expect(pushedScreen()).toHaveProperty('inert', false)
      expect(pushedScreen()?.style.transform).toBe('none')

      yield* click(yield* findByRole('button', 'Back to agents'))
      yield* eventually(() => {
        expect(router.state.location.pathname).toBe('/')
      })

      expect(document.activeElement).toBe(opener)
    }),
  )

  it.effect('stays usable when Back lands on another entry of the same screen', () =>
    Effect.gen(function* () {
      const router = yield* renderAt('/')

      router.history.push('/detail')
      router.history.push('/detail')
      const title = yield* findByRole('heading', 'Detail')

      yield* click(yield* findByRole('button', 'Back to agents'))
      yield* eventually(() => {
        expect(router.history.canGoBack()).toBe(true)
        expect(pushedScreen()).toHaveProperty('inert', false)
      })

      expect(router.state.location.pathname).toBe('/detail')
      expect(document.activeElement).toBe(title)

      yield* click(yield* findByRole('button', 'Back to agents'))
      yield* eventually(() => {
        expect(router.state.location.pathname).toBe('/')
      })
    }),
  )

  it.effect('opens one screen when its opener is tapped twice', () =>
    Effect.gen(function* () {
      const router = yield* renderAt('/')
      const opener = yield* findByRole('button', 'Open detail from a tap')

      void router.navigate({ href: '/detail', state: openedFrom(opener) })
      void router.navigate({ href: '/detail', state: openedFrom(opener) })
      yield* click(yield* findByRole('button', 'Back to agents'))
      yield* eventually(() => {
        expect(router.state.location.pathname).toBe('/')
      })

      expect(router.history.canGoBack()).toBe(false)
      expect(document.activeElement).toBe(opener)
    }),
  )

  it.effect('leaves focus to a nested pushed screen, and its Back returns it to its opener', () =>
    Effect.gen(function* () {
      yield* renderAt('/')
      const rootOpener = yield* findByRole('button', 'Open detail from a tap')

      fireEvent.click(rootOpener)
      const nestedOpener = yield* findByRole('button', 'Open more')

      fireEvent.click(nestedOpener)
      const nestedTitle = yield* findByRole('heading', 'More')

      yield* eventually(() => {
        expect(document.activeElement).toBe(nestedTitle)
      })
      yield* click(yield* findByRole('button', 'Back to detail'))
      yield* eventually(() => {
        expect(screen.queryByRole('heading', { name: 'More' })).toBeNull()
      })

      expect(document.activeElement).toBe(nestedOpener)

      yield* click(yield* findByRole('button', 'Back to agents'))
      yield* eventually(() => {
        expect(screen.queryByRole('heading', { name: 'Detail' })).toBeNull()
      })

      expect(document.activeElement).toBe(rootOpener)
    }),
  )

  it.effect(
    'fits the visible part of the viewport while the keyboard is up, and lets go after',
    () =>
      Effect.gen(function* () {
        const viewport = emulateVisualViewport()

        yield* renderAt('/detail')
        yield* findByRole('heading', 'Detail')
        moveVisualViewport(viewport, {
          height: window.innerHeight / 2,
          offsetTop: window.innerHeight / 4,
        })
        yield* eventually(() => {
          expect(pushedScreen()?.dataset['keyboard']).toBe('open')
        })

        expect(pushedScreen()?.style.top).toBe(`${window.innerHeight / 4}px`)
        expect(pushedScreen()?.style.height).toBe(`${window.innerHeight / 2}px`)
        expect(pushedScreen()?.style.bottom).toBe('auto')

        moveVisualViewport(viewport, { height: window.innerHeight, offsetTop: 0 })
        yield* eventually(() => {
          expect(pushedScreen()?.dataset['keyboard']).toBeUndefined()
        })

        expect(pushedScreen()?.style.top).toBe('')
        expect(pushedScreen()?.style.height).toBe('')
      }),
  )

  it.effect('scrolls the page back to the top when the keyboard scrolls it', () =>
    Effect.gen(function* () {
      const viewport = emulateVisualViewport()
      const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)

      yield* renderAt('/detail')
      yield* findByRole('heading', 'Detail')
      moveVisualViewport(viewport, { height: window.innerHeight / 2 })
      Object.defineProperty(window, 'scrollY', {
        configurable: true,
        value: window.innerHeight / 4,
      })
      moveVisualViewport(viewport, { offsetTop: window.innerHeight / 4 }, 'scroll')

      expect(scrollTo).toHaveBeenCalledWith(0, 0)
    }),
  )

  it.effect('leaves the page where it is while no keyboard is up', () =>
    Effect.gen(function* () {
      const viewport = emulateVisualViewport()
      const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)

      yield* renderAt('/detail')
      yield* findByRole('heading', 'Detail')
      Object.defineProperty(window, 'scrollY', {
        configurable: true,
        value: window.innerHeight / 4,
      })
      moveVisualViewport(viewport, {}, 'scroll')

      expect(scrollTo).not.toHaveBeenCalledWith(0, 0)
      expect(pushedScreen()?.dataset['keyboard']).toBeUndefined()
    }),
  )

  it.effect('keeps its full height under a pinch zoom', () =>
    Effect.gen(function* () {
      const viewport = emulateVisualViewport()

      yield* renderAt('/detail')
      yield* findByRole('heading', 'Detail')
      moveVisualViewport(viewport, { height: window.innerHeight / 2, scale: 2 })

      expect(pushedScreen()?.dataset['keyboard']).toBeUndefined()
      expect(pushedScreen()?.style.height).toBe('')
    }),
  )
})
