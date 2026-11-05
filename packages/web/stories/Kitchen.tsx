import { RegistryContext } from '@effect/atom-react/RegistryContext'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router'
import * as Arr from 'effect/Array'
import * as Effect from 'effect/Effect'
import { pipe } from 'effect/Function'
import * as Option from 'effect/Option'
import * as Record from 'effect/Record'
import { useEffect, useState } from 'react'
import type { ComponentType } from 'react'

import { ROUTE_FALLBACKS } from '@crook/web/router/RouteFallbacks'
import { Route as RealRoot } from '@crook/web/routes/__root'
import type { HubLinkState } from '@crook/web/rpc/HubLinkState'

import { liveWith } from '../test/AppWiring.tsx'
import { makeFakeHubLink } from '../test/HubFakes.ts'
import { TEAM } from './Fixtures.ts'
import { KitchenPicker } from './KitchenPicker.tsx'
import { acquireRegistry, DEFAULT_ENV, mountedScene, StoryStepFailed } from './Story.tsx'
import type { FakeLink, Story } from './Story.tsx'

export interface PrototypeVariant {
  readonly name: string
  readonly axis: string
  readonly Component: ComponentType
}

export interface Prototype {
  readonly title: string
  readonly variants: readonly PrototypeVariant[]
  readonly link?: HubLinkState
  readonly arrange?: (link: FakeLink) => Effect.Effect<void>
  readonly pickerPosition?: 'bottom' | 'top'
  readonly hasReplay?: boolean
}

export type PrototypeLoader = () => Promise<{ readonly prototype: Prototype }>

const VARIANT_PARAM = 'v'
const KITCHEN_GROUP = 'kitchen'
const KITCHEN_PATH = '/'
const TYPING_TAGS: readonly string[] = ['INPUT', 'TEXTAREA', 'SELECT']
const REPLAY_KEYS: readonly string[] = ['r', 'R']

const firstVariant = (count: number): number =>
  pipe(
    Option.fromNullishOr(new URLSearchParams(window.location.search).get(VARIANT_PARAM)),
    Option.map(Number),
    Option.filter((asked) => Number.isInteger(asked) && asked >= 1 && asked <= count),
    Option.match({ onNone: () => 0, onSome: (asked) => asked - 1 }),
  )

const isTyping = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement &&
  (TYPING_TAGS.includes(target.tagName) || target.isContentEditable)

const kitchenRouter = (prototype: Prototype) => {
  const root = createRootRoute({ component: RealRoot.options.component ?? Outlet })
  const stage = createRoute({
    getParentRoute: () => root,
    path: '$',
    component: () => <KitchenStage prototype={prototype} />,
  })

  return createRouter({
    routeTree: root.addChildren([stage]),
    history: createMemoryHistory({ initialEntries: [KITCHEN_PATH] }),
    ...ROUTE_FALLBACKS,
  })
}

const kitchenStory = (slug: string, load: PrototypeLoader): Story => ({
  id: `${KITCHEN_GROUP}/${slug}`,
  group: KITCHEN_GROUP,
  title: slug,
  note: Option.none(),
  path: KITCHEN_PATH,
  env: DEFAULT_ENV,
  kind: 'state',
  steps: [],
  witness: Option.some({ selector: '.proto-picker' }),
  endWitness: Option.none(),
  start: Effect.gen(function* () {
    const { prototype } = yield* Effect.tryPromise({
      try: load,
      catch: (cause) => new StoryStepFailed({ step: `loads ${slug}`, detail: String(cause) }),
    })
    const link = yield* makeFakeHubLink(prototype.link ?? liveWith(TEAM))
    const registry = yield* acquireRegistry(link.layer)
    const router = kitchenRouter(prototype)

    yield* prototype.arrange === undefined ? Effect.void : prototype.arrange(link)

    return {
      render: mountedScene(
        <RegistryContext value={registry}>
          <RouterProvider router={router} />
        </RegistryContext>,
        () => router.load(),
      ),
      settle: Effect.void,
      steps: [],
    }
  }),
})

const slugOf = (path: string): Option.Option<string> =>
  Option.fromNullishOr(/\/kitchen\/([^/]+)\/Prototype\.tsx$/u.exec(path)?.[1])

export const kitchenStoriesFrom = (
  loaders: Readonly<Record<string, PrototypeLoader>>,
): readonly Story[] =>
  pipe(
    Record.toEntries(loaders),
    Arr.flatMap(([path, load]) =>
      Option.match(slugOf(path), {
        onNone: () => [],
        onSome: (slug) => [kitchenStory(slug, load)],
      }),
    ),
  )

export const KITCHEN_STORIES = kitchenStoriesFrom(
  import.meta.glob<{ readonly prototype: Prototype }>('./kitchen/*/Prototype.tsx'),
)

function KitchenStage({ prototype }: { prototype: Prototype }) {
  const count = prototype.variants.length
  const [current, setCurrent] = useState(() => firstVariant(count))
  const [mounts, setMounts] = useState(0)

  const remount = () => {
    setMounts((value) => value + 1)
  }

  const select = (index: number) => {
    const url = new URL(window.location.href)

    url.searchParams.set(VARIANT_PARAM, String(index + 1))
    window.history.replaceState(null, '', url)
    setCurrent(index)
    remount()
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isTyping(event.target) || event.metaKey || event.ctrlKey || event.altKey) {
        return
      }

      const asked = Number.parseInt(event.key, 10)

      if (asked >= 1 && asked <= count) {
        select(asked - 1)
      } else if (event.key === 'ArrowRight') {
        select((current + 1) % count)
      } else if (event.key === 'ArrowLeft') {
        select((current - 1 + count) % count)
      } else if (REPLAY_KEYS.includes(event.key)) {
        remount()
      }
    }

    document.addEventListener('keydown', onKey)

    return () => {
      document.removeEventListener('keydown', onKey)
    }
  })

  const Variant = prototype.variants[current]?.Component

  return (
    <>
      {Variant === undefined ? null : <Variant key={`${current} ${mounts}`} />}
      <KitchenPicker
        names={Arr.map(prototype.variants, (variant) => variant.name)}
        active={current}
        hasReplay={prototype.hasReplay ?? false}
        position={prototype.pickerPosition ?? 'bottom'}
        onSelect={select}
        onReplay={remount}
      />
    </>
  )
}
