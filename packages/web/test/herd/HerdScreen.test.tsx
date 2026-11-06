import { describe, expect, it } from '@effect/vitest'
import { fireEvent, screen, within } from '@testing-library/react'
import * as DateTime from 'effect/DateTime'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import * as Ref from 'effect/Ref'
import * as SubscriptionRef from 'effect/SubscriptionRef'
import { afterEach, beforeEach, vi } from 'vitest'

import { PermissionAsk, RunCommand } from '@crook/domain/Ask'
import { AskId } from '@crook/domain/Ids'
import { ANNOUNCED, EXPIRED, UNREACHABLE } from '@crook/web/rpc/HubLinkState'

import { liveWith, renderApp, stateWith } from '../AppRender.tsx'
import { click, eventually, findByRole, present, wait } from '../Dom.ts'
import { agent, DESK, herd, LAPTOP, machine, START } from '../HerdFixtures.ts'
import { stubMediaQueries } from '../MediaQueries.ts'

const KEPT_TITLE = 'Port the herd screen'
const HEALTHY_TITLE = 'Run the nightly build'

const busyLaptop = machine(LAPTOP, [
  agent('w1:p1', 'working', { title: 'Port the herd screen', secondsAgo: 42 }),
  agent('w1:p2', 'blocked', { title: 'Wire the hub link', secondsAgo: 180, branch: 'feat/jc-93' }),
  agent('w1:p3', 'done', { title: 'Write the banner', secondsAgo: 7200 }),
])

const cardTitles = () =>
  Array.from(document.querySelectorAll('[data-slot="agent-title"]'), (title) => title.textContent)

const visibleText = (element: Element | null | undefined) =>
  Array.from(element?.children ?? [])
    .filter((child) => !child.classList.contains('sr-only'))
    .map((child) => child.textContent)
    .join(' ')

const statusPills = () =>
  Array.from(document.querySelectorAll('[data-slot="agent-status"]'), visibleText)

const cardOf = (title: string) =>
  present(screen.getByText(title).closest('[data-slot="agent-card"]'), `The card titled ${title}`)

const pillOf = (title: string) =>
  visibleText(cardOf(title).querySelector('[data-slot="agent-status"]'))

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
      expect(statusPills()).toEqual(['Needs you 3m 00s', 'Done 2h', 'Working 42s'])
      expect(document.querySelector('[data-slot="agent-status"] .sr-only')?.textContent).toBe('3m')
    }),
  )

  it.effect('shows what a blocked agent asks as a line of its own under where it runs', () =>
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

      const card = summary.closest('[data-slot="agent-card"]')

      expect(summary.getAttribute('data-slot')).toBe('ask-summary')
      expect(summary.previousElementSibling?.getAttribute('data-slot')).toBe('agent-status')
      expect(visibleText(summary.previousElementSibling)).toBe('Needs you 0s')
      expect(card?.querySelector('[data-slot="agent-place"]')?.textContent).toBe('crook/web')
      expect(summary.closest('[data-slot="swipe-card"]')?.className).toContain(
        'border-[color-mix(in_oklab,var(--warning)_45%,var(--border))]',
      )
    }),
  )

  it.effect('marks each card with its status icon, breathing only while it works', () =>
    Effect.gen(function* () {
      yield* renderApp('/', liveWith(herd([busyLaptop])))
      yield* findByRole('button', 'laptop online 2 need you')
      const icons = Array.from(document.querySelectorAll('[data-slot="status-icon"] > *'))
      const working = document.querySelector(
        '[data-slot="status-icon"] [data-status="working"] svg',
      )

      expect(icons.map((icon) => icon.getAttribute('data-status'))).toEqual([
        'blocked',
        'done',
        'working',
      ])
      expect(working?.getAttribute('class')).toContain('animate-breathe')
      expect(working?.getAttribute('class')).toContain('motion-reduce:animate-none')
    }),
  )

  it.effect('counts the subagents an agent runs beside its branch, and nothing when none run', () =>
    Effect.gen(function* () {
      yield* renderApp(
        '/',
        liveWith(
          herd([
            machine(LAPTOP, [
              agent('w1:p1', 'working', {
                title: 'Port the herd screen',
                branch: 'feat/jc-139',
                runningSubagents: 2,
              }),
              agent('w1:p2', 'idle', { title: 'Wire the hub link', runningSubagents: 0 }),
              agent('w1:p3', 'idle', { title: 'Write the banner' }),
            ]),
          ]),
        ),
      )
      const title = yield* Effect.promise(() => screen.findByText('Port the herd screen'))
      const counts = document.querySelectorAll('[data-slot="running-subagents"]')

      expect(counts).toHaveLength(1)
      expect(title.closest('[data-slot="agent-card"]')?.textContent).toContain(
        'feat/jc-1392 subagents running',
      )
      expect(counts[0]?.querySelectorAll('[aria-hidden="true"] > span')).toHaveLength(2)
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
      yield* renderApp('/', stateWith(ANNOUNCED, Option.none()))

      const loading = yield* Effect.promise(() => screen.findByText('Loading your agents'))

      expect(loading.closest('[role="status"]')).not.toBeNull()
      expect(document.querySelectorAll('[skullet-ghost] [data-slot="swipe-card"]')).toHaveLength(5)
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

  it.effect('stops a lost machine at the moment herdr went and resumes it once herdr is back', () =>
    Effect.gen(function* () {
      const kept = [agent('w1:p1', 'working', { title: KEPT_TITLE, secondsAgo: 42 })]
      const healthy = machine(DESK, [
        agent('w2:p1', 'working', { title: HEALTHY_TITLE, secondsAgo: 42 }),
      ])
      const { link } = yield* renderApp(
        '/',
        liveWith(herd([machine(LAPTOP, kept, { herdrLostAt: START }), healthy])),
      )

      expect((yield* findByRole('button', 'laptop online herdr lost')).tagName).toBe('BUTTON')
      expect(screen.getByRole('button', { name: 'desk online' })).toBeDefined()

      vi.setSystemTime(DateTime.addDuration(START, Duration.minutes(1)).epochMilliseconds)

      yield* eventually(() => {
        expect(pillOf(HEALTHY_TITLE)).toBe('Working 1m 42s')
      })

      expect(pillOf(KEPT_TITLE)).toBe('Working 42s')
      expect(present(cardOf(KEPT_TITLE).closest('[data-kept]'), 'The kept card')).toBeDefined()
      expect(cardOf(HEALTHY_TITLE).closest('[data-kept]')).toBeNull()

      yield* SubscriptionRef.set(
        link.state,
        liveWith(herd([machine(LAPTOP, kept, { herdrConnection: 2 }), healthy])),
      )
      yield* eventually(() => {
        expect(pillOf(KEPT_TITLE)).toBe('Working 1m 42s')
      })

      expect(cardOf(KEPT_TITLE).closest('[data-kept]')).toBeNull()
      expect(screen.getByRole('button', { name: 'laptop online' })).toBeDefined()
    }),
  )

  it.effect('reads a stopped clock from when herdr went, however late the row mounts', () =>
    Effect.gen(function* () {
      vi.setSystemTime(DateTime.addDuration(START, Duration.minutes(5)).epochMilliseconds)

      yield* renderApp(
        '/',
        liveWith(
          herd([
            machine(LAPTOP, [agent('w1:p1', 'working', { title: KEPT_TITLE, secondsAgo: 42 })], {
              herdrLostAt: START,
            }),
          ]),
        ),
      )

      yield* findByRole('button', 'laptop online herdr lost')

      expect(pillOf(KEPT_TITLE)).toBe('Working 42s')
    }),
  )

  it.effect('keeps a kept row still: no breathing and no asking border', () =>
    Effect.gen(function* () {
      const ask = new PermissionAsk({
        id: AskId.make('toolu_kept'),
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
          herd([
            machine(
              LAPTOP,
              [
                agent('w1:p1', 'working', { title: KEPT_TITLE }),
                agent('w1:p2', 'blocked', { title: HEALTHY_TITLE, ask }),
              ],
              { herdrLostAt: START },
            ),
          ]),
        ),
      )

      yield* findByRole('button', 'laptop online herdr lost 1 needs you')
      const working = document.querySelector(
        '[data-slot="status-icon"] [data-status="working"] svg',
      )

      expect(working?.getAttribute('class')).not.toContain('animate-breathe')
      expect(cardOf(KEPT_TITLE).className).toContain('[--primary:var(--muted-foreground)]')
      expect(cardOf(HEALTHY_TITLE).closest('[data-slot="swipe-card"]')?.className).not.toContain(
        'var(--warning)',
      )
    }),
  )

  it.effect('opens the chat of a row kept while herdr is lost', () =>
    Effect.gen(function* () {
      const { router } = yield* renderApp(
        '/',
        liveWith(
          herd([
            machine(LAPTOP, [agent('w1:p1', 'working', { title: KEPT_TITLE })], {
              herdrLostAt: START,
            }),
          ]),
        ),
      )

      const title = yield* Effect.promise(() => screen.findByText(KEPT_TITLE))

      expect(title.closest('[data-kept]')).not.toBeNull()

      yield* click(title)
      yield* eventually(() => {
        expect(router.state.location.pathname).toBe('/m/laptop/p/w1%3Ap1')
      })
    }),
  )

  it.effect('says each machine has its own reason for showing nothing', () =>
    Effect.gen(function* () {
      yield* renderApp(
        '/',
        liveWith(herd([machine(LAPTOP, [], { herdrLostAt: START }), machine(DESK, [])])),
      )

      expect(yield* findByRole('button', 'laptop online herdr lost')).toBeDefined()
      expect(screen.getByText("Can't see this machine's agents while herdr is away")).toBeDefined()
      expect(screen.getByText('No agents')).toBeDefined()
      expect(screen.queryByText('Nothing running')).toBeNull()
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
      yield* renderApp('/', stateWith(UNREACHABLE, Option.some(herd([busyLaptop]))))
      const banner = yield* Effect.promise(() =>
        screen.findByText("Can't reach the hub · retrying"),
      )

      expect(banner.closest('[data-slot="connection-banner"]')?.textContent).toContain(
        'Updated just now',
      )
      expect(document.querySelector('[data-state="dimmed"]')).not.toBeNull()
      expect(screen.getByRole('button', { name: 'New agent' }).hasAttribute('disabled')).toBe(true)
      expect(screen.getAllByRole('status').map((region) => region.textContent)).toContainEqual(
        expect.stringContaining("Can't reach the hub. crook keeps retrying."),
      )
    }),
  )

  it.effect('shows the logged-out screen when the session expired', () =>
    Effect.gen(function* () {
      yield* renderApp('/', stateWith(EXPIRED, Option.some(herd([busyLaptop]))))

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
        fireEvent.touchStart(zone, { touches: [{ clientX: 100, clientY: 0 }] })
        fireEvent.touchMove(zone, { touches: [{ clientX: 100, clientY: 200 }] })
        fireEvent.touchEnd(zone, { touches: [] })
      }

      yield* eventually(() => {
        expect(Ref.getUnsafe(link.resyncs)).toBe(1)
      })
    }),
  )

  it.effect('leaves the herd still when a drag at the top starts sideways', () =>
    Effect.gen(function* () {
      const { link } = yield* renderApp('/', liveWith(herd([busyLaptop])))
      const zone = document.querySelector('[data-slot="pull-to-resync"]')
      const content = zone?.lastElementChild

      expect(content).toBeInstanceOf(HTMLElement)

      if (zone !== null && content instanceof HTMLElement) {
        fireEvent.touchStart(zone, { touches: [{ clientX: 200, clientY: 0 }] })
        fireEvent.touchMove(zone, { touches: [{ clientX: 170, clientY: 12 }] })
        fireEvent.touchMove(zone, { touches: [{ clientX: 140, clientY: 200 }] })

        expect(content.style.transform).toBe('')

        fireEvent.touchEnd(zone, { touches: [] })
      }

      yield* wait(50)

      expect(Ref.getUnsafe(link.resyncs)).toBe(0)
    }),
  )
})
