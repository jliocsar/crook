import { describe, expect, it } from '@effect/vitest'
import { fireEvent, screen, within } from '@testing-library/react'
import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import * as Ref from 'effect/Ref'
import * as SubscriptionRef from 'effect/SubscriptionRef'
import { afterEach, beforeEach, vi } from 'vitest'

import { PermissionAsk, RunCommand } from '@crook/domain/Ask'
import { AskId } from '@crook/domain/Ids'
import { LinkStatus } from '@crook/web/rpc/HubLinkState'

import { liveWith, renderApp, stateWith } from '../AppRender.tsx'
import { click, eventually, findByRole, wait } from '../Dom.ts'
import { agent, DESK, herd, LAPTOP, machine, START } from '../HerdFixtures.ts'
import { stubMediaQueries } from '../MediaQueries.ts'

const busyLaptop = machine(LAPTOP, [
  agent('w1:p1', 'working', { title: 'Port the herd screen', secondsAgo: 42 }),
  agent('w1:p2', 'blocked', { title: 'Wire the hub link', secondsAgo: 180, branch: 'feat/jc-93' }),
  agent('w1:p3', 'done', { title: 'Write the banner', secondsAgo: 7200 }),
])

const cardTitles = () =>
  Array.from(document.querySelectorAll('[data-slot="agent-title"]'), (title) => title.textContent)

beforeEach(() => {
  stubMediaQueries(['(prefers-reduced-motion)'])
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(START.epochMilliseconds)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('HerdScreen', () => {
  it.effect('shows one section per machine with its cards in priority order', () =>
    Effect.gen(function* () {
      yield* renderApp('/', liveWith(herd([busyLaptop])))
      const laptop = yield* findByRole('button', 'laptop online 2 need you')

      expect(laptop.getAttribute('aria-expanded')).toBe('true')
      expect(cardTitles()).toEqual([
        'Wire the hub link',
        'Write the banner',
        'Port the herd screen',
      ])
      expect(screen.getByText('feat/jc-93')).toBeDefined()
      expect(screen.getByText('3m')).toBeDefined()
      expect(screen.getByText('2h')).toBeDefined()
    }),
  )

  it.effect('shows what a blocked agent asks in place of where it runs', () =>
    Effect.gen(function* () {
      const ask = new PermissionAsk({
        id: AskId.make('toolu_01XXC3'),
        source: 'hook',
        tool: 'Bash',
        plugin: Option.none(),
        action: new RunCommand({ command: 'bun run lint' }),
        options: [],
        dialog: Option.none(),
      })

      yield* renderApp(
        '/',
        liveWith(
          herd([machine(LAPTOP, [agent('w1:p2', 'blocked', { title: 'Wire the hub link', ask })])]),
        ),
      )
      const summary = yield* Effect.promise(() => screen.findByText('Bash bun run lint'))

      expect(summary.getAttribute('data-slot')).toBe('ask-summary')
      expect(summary.closest('[data-slot="agent-card"]')?.textContent).not.toContain('crook · web')
    }),
  )

  it.effect('counts who needs you on the tab, leaving out offline machines', () =>
    Effect.gen(function* () {
      yield* renderApp(
        '/',
        liveWith(
          herd([busyLaptop, machine(DESK, [agent('w1:p1', 'blocked')], { connection: 'offline' })]),
        ),
      )

      expect((yield* findByRole('link', 'Agents , 2 need you')).textContent).toContain('2')
      expect(
        screen.getByText('Last seen 2h ago. Its agents come back when it reconnects.'),
      ).toBeDefined()
      expect(screen.getByRole('button', { name: 'desk offline · 2h ago' })).toBeDefined()
    }),
  )

  it.effect('shows skeleton sections on a first load and hides the badge', () =>
    Effect.gen(function* () {
      yield* renderApp(
        '/',
        stateWith(
          LinkStatus.Dialing({ announced: true, afterFailure: false, coldStart: true }),
          Option.none(),
        ),
      )

      const loading = yield* Effect.promise(() => screen.findByText('Loading your agents'))

      expect(loading.closest('[role="status"]')).not.toBeNull()
      expect(screen.getByRole('link', { name: 'Agents' })).toBeDefined()
      expect(screen.getAllByText('Connecting to the hub').length).toBeGreaterThan(0)
    }),
  )

  it.effect('says nothing is running and offers a new agent', () =>
    Effect.gen(function* () {
      const { router } = yield* renderApp('/', liveWith(herd([machine(LAPTOP, [])])))

      const empty = yield* Effect.promise(() => screen.findByText('Nothing running'))

      yield* click(
        within(empty.closest('[data-slot="empty-state"]') ?? document.body).getByRole('button', {
          name: 'New agent',
        }),
      )

      yield* eventually(() => {
        expect(router.state.location.pathname).toBe('/new')
      })
    }),
  )

  it.effect('says when every machine is offline, when none exist, and when one has no agents', () =>
    Effect.gen(function* () {
      const { link } = yield* renderApp(
        '/',
        liveWith(herd([machine(LAPTOP, [], { connection: 'offline' })])),
      )

      expect((yield* findByRole('button', 'laptop offline · 2h ago')).tagName).toBe('BUTTON')
      expect(screen.getByText('All machines are offline')).toBeDefined()

      yield* SubscriptionRef.set(link.state, liveWith(herd([])))
      yield* eventually(() => {
        expect(screen.getByText('No machines yet')).toBeDefined()
      })

      yield* SubscriptionRef.set(link.state, liveWith(herd([busyLaptop, machine(DESK, [])])))
      yield* eventually(() => {
        expect(screen.getByText('No agents')).toBeDefined()
      })
    }),
  )

  it.effect('collapses a machine section', () =>
    Effect.gen(function* () {
      yield* renderApp('/', liveWith(herd([busyLaptop])))
      const laptop = yield* findByRole('button', 'laptop online 2 need you')

      yield* click(laptop)

      expect(laptop.getAttribute('aria-expanded')).toBe('false')

      yield* eventually(() => {
        expect(cardTitles()).toEqual([])
      })
    }),
  )

  it.effect('dims the herd and disables hub actions while the hub is unreachable', () =>
    Effect.gen(function* () {
      yield* renderApp('/', stateWith(LinkStatus.Unreachable(), Option.some(herd([busyLaptop]))))
      const banner = yield* Effect.promise(() =>
        screen.findByText("Can't reach the hub · retrying"),
      )

      expect(banner.closest('[data-slot="connection-banner"]')?.textContent).toContain(
        'Updated just now',
      )
      expect(document.querySelector('[data-dimmed="true"]')).not.toBeNull()
      expect(screen.getByRole('button', { name: 'New agent' }).hasAttribute('disabled')).toBe(true)
      expect(screen.getByRole('status', { name: '' }).textContent).toContain(
        "Can't reach the hub. crook keeps retrying.",
      )
    }),
  )

  it.effect('shows the logged-out screen when the session expired', () =>
    Effect.gen(function* () {
      yield* renderApp('/', stateWith(LinkStatus.Expired(), Option.some(herd([busyLaptop]))))

      expect((yield* findByRole('heading', 'Your session expired')).tagName).toBe('H1')
      expect(screen.getByRole('button', { name: 'Log in with exe.dev' })).toBeDefined()
      expect(screen.queryByRole('navigation')).toBeNull()
    }),
  )

  it.effect("opens an agent's chat with its real header and marks it seen", () =>
    Effect.gen(function* () {
      const { router, link } = yield* renderApp('/', liveWith(herd([busyLaptop])))

      yield* click(yield* Effect.promise(() => screen.findByText('Write the banner')))
      yield* eventually(() => {
        expect(router.state.location.pathname).toBe('/m/laptop/p/w1%3Ap3')
      })
      const header = yield* findByRole('heading', 'Write the banner')

      expect(within(header.closest('header') ?? document.body).getByText('done')).toBeDefined()
      expect(screen.getByRole('button', { name: 'Back to Agents' })).toBeDefined()

      yield* eventually(() => {
        expect(Ref.getUnsafe(link.seen)).toContainEqual({
          machine: LAPTOP,
          pane: agent('w1:p3', 'done').pane,
        })
      })
    }),
  )

  it.effect('marks an open agent seen once while the rest of the herd keeps changing', () =>
    Effect.gen(function* () {
      const quietDesk = machine(DESK, [agent('w2:p1', 'working', { secondsAgo: 5 })])
      const busierDesk = machine(DESK, [agent('w2:p1', 'blocked', { secondsAgo: 1 })])
      const { link } = yield* renderApp(
        '/m/laptop/p/w1%3Ap3',
        liveWith(herd([busyLaptop, quietDesk])),
      )
      const opened = { machine: LAPTOP, pane: agent('w1:p3', 'done').pane }

      yield* eventually(() => {
        expect(Ref.getUnsafe(link.seen)).toEqual([opened])
      })
      yield* SubscriptionRef.set(link.state, liveWith(herd([busyLaptop, busierDesk])))
      yield* wait(0)
      yield* SubscriptionRef.set(link.state, liveWith(herd([busyLaptop, quietDesk])))
      yield* wait(0)

      expect(Ref.getUnsafe(link.seen)).toEqual([opened])
    }),
  )

  it.effect('pulls to resync while the hub is live', () =>
    Effect.gen(function* () {
      const { link } = yield* renderApp('/', liveWith(herd([busyLaptop])))
      const zone = document.querySelector('[data-slot="pull-to-resync"]')

      expect(zone).not.toBeNull()

      if (zone !== null) {
        fireEvent.touchStart(zone, { touches: [{ clientY: 0 }] })
        fireEvent.touchMove(zone, { touches: [{ clientY: 200 }] })
        fireEvent.touchEnd(zone, { touches: [] })
      }

      yield* eventually(() => {
        expect(Ref.getUnsafe(link.resyncs)).toBe(1)
      })
    }),
  )
})
