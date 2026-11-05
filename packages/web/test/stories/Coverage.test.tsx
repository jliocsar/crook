import { describe, expect, it } from '@effect/vitest'
import * as Arr from 'effect/Array'
import { pipe } from 'effect/Function'
import * as Order from 'effect/Order'
import * as Record from 'effect/Record'

import { AgentStatus } from '@crook/domain/AgentStatus'
import { MachineConnection } from '@crook/domain/Machine'
import { SubagentStatus } from '@crook/domain/Subagent'

import { LINK_MOMENTS, LINK_SCREENS } from '../../stories/catalog/Link.tsx'
import { CATALOG_STORIES } from '../../stories/Catalog.ts'
import {
  LINK_STATUS_MOMENTS,
  MOMENT_BEFORE_ANY_STATUS,
  REQUIRED_SCREENS,
  REQUIRED_TRANSITIONS,
  STATE_COVERAGE,
} from '../../stories/Coverage.ts'
import { appRouter } from '../AppWiring.tsx'

const ROOT_ROUTE_ID = '__root__'
const NOT_FOUND_STORY = 'gate/not-found'

const ids = new Set(CATALOG_STORIES.map((story) => story.id))
const missing = (wanted: readonly string[]) => wanted.filter((id) => !ids.has(id))

const routeOf = (router: ReturnType<typeof appRouter>, path: string): string => {
  const route: { readonly id: string } | undefined = router
    .getMatchedRoutes(path.split('?')[0] ?? path)[0]
    .at(-1)

  return route?.id ?? ROOT_ROUTE_ID
}

describe('the story catalog', () => {
  const router = appRouter('/')
  const allRoutes = Object.keys(router.routesById)
  const leafRoutes = pipe(
    allRoutes,
    Arr.filter(
      (id) =>
        id !== ROOT_ROUTE_ID &&
        !allRoutes.some((other) => other !== id && other.startsWith(`${id}/`)),
    ),
  )

  it('gives every story its own id', () => {
    expect(ids.size).toBe(CATALOG_STORIES.length)
  })

  it('names a moment for every link status and a status for every moment', () => {
    const named = [MOMENT_BEFORE_ANY_STATUS, ...Arr.flatten(Record.values(LINK_STATUS_MOMENTS))]

    expect(Arr.sort(named, Order.String)).toEqual(
      Arr.sort(
        LINK_MOMENTS.map((moment) => moment.slug),
        Order.String,
      ),
    )
  })

  it('tells every link moment on every screen', () => {
    const matrix = LINK_MOMENTS.flatMap((moment) =>
      LINK_SCREENS.map((screen) => `link/${moment.slug}/${screen.slug}`),
    )

    expect(missing(matrix)).toEqual([])
  })

  it('puts every screen that has a route of its own in the link matrix', () => {
    const reached = LINK_SCREENS.map((screen) => routeOf(router, screen.path))

    expect(leafRoutes.filter((id) => !reached.includes(id))).toEqual([])
  })

  it('has a story on every route', () => {
    const reached = CATALOG_STORIES.map((story) => routeOf(router, story.path))

    expect(leafRoutes.filter((id) => !reached.includes(id))).toEqual([])
  })

  it('sends every story to a route that exists', () => {
    const lost = CATALOG_STORIES.filter(
      (story) => story.id !== NOT_FOUND_STORY && routeOf(router, story.path) === ROOT_ROUTE_ID,
    )

    expect(lost.map((story) => story.id)).toEqual([])
  })

  it.each(Object.entries(STATE_COVERAGE))('has a story for every member of %s', (_name, table) => {
    expect(missing(Arr.flatten(Object.values(table)))).toEqual([])
  })

  it('has a card for every agent status', () => {
    expect(missing(AgentStatus.literals.map((status) => `herd/card-${status}`))).toEqual([])
  })

  it('has a section for every way a machine connects', () => {
    expect(MachineConnection.literals).toEqual(['online', 'reconnecting', 'offline'])
    expect(missing(['herd/full', 'herd/section-reconnecting', 'herd/section-offline'])).toEqual([])
  })

  it('has a subagent tree for every run status', () => {
    expect(
      missing(SubagentStatus.literals.map((status) => `rows/subagent-tree-${status}`)),
    ).toEqual([])
  })

  it('has the screens and transitions it promises', () => {
    expect(missing([...REQUIRED_SCREENS, ...REQUIRED_TRANSITIONS])).toEqual([])
  })

  it('makes every required transition a timeline', () => {
    const stills = CATALOG_STORIES.filter(
      (story) => REQUIRED_TRANSITIONS.includes(story.id) && story.kind !== 'transition',
    )

    expect(stills.map((story) => story.id)).toEqual([])
  })
})
