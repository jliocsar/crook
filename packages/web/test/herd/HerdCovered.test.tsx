import { describe, expect, it } from '@effect/vitest'
import * as DateTime from 'effect/DateTime'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as SubscriptionRef from 'effect/SubscriptionRef'
import { MotionGlobalConfig, rootProjectionNode } from 'motion/react'
import { fireEvent } from '@testing-library/react'
import { afterEach, beforeEach, vi } from 'vitest'

import type { AgentStatus } from '@crook/domain/AgentStatus'

import { liveWith, renderApp } from '../AppRender.tsx'
import { click, eventually, findByRole, present, wait } from '../Dom.ts'
import { agent, DESK, herd, LAPTOP, machine, START } from '../HerdFixtures.ts'
import { stubMediaQueries } from '../MediaQueries.ts'

const SHORTER_THAN_AN_EXIT_MS = 40
const LONGER_THAN_A_TICK_MS = 1100

const laptop = machine(LAPTOP, [
  agent('w1:p1', 'working', { title: 'Port the herd screen', secondsAgo: 42 }),
  agent('w1:p2', 'idle', { title: 'Wire the hub link', secondsAgo: 600 }),
])

const desk = (status: AgentStatus, titles: readonly string[]) =>
  machine(
    DESK,
    titles.map((title, index) => agent(`w2:p${index + 1}`, status, { title, secondsAgo: 5 })),
  )

const herdScreen = () =>
  present(document.querySelector<HTMLElement>('[data-slot="tab-scroller"]'), 'the herd')

const cardOf = (title: string) =>
  Array.from(herdScreen().querySelectorAll('[data-slot="agent-card"]')).find(
    (card) => card.querySelector('[data-slot="agent-title"]')?.textContent === title,
  )

const herdTitles = () =>
  Array.from(
    herdScreen().querySelectorAll('[data-slot="agent-title"]'),
    (title) => title.textContent,
  )

const pillText = (title: string) =>
  Array.from(cardOf(title)?.querySelector('[data-slot="agent-status"]')?.children ?? [])
    .filter((child) => !child.classList.contains('sr-only'))
    .map((child) => child.textContent)
    .join(' ')

const iconsOf = (title: string) =>
  Array.from(cardOf(title)?.querySelectorAll('[data-slot="status-icon"] > *') ?? [], (icon) =>
    icon.getAttribute('data-status'),
  )

const PUSHED_SCREEN = '[data-slot="pushed-screen"]'

const pushedScreen = () =>
  present(document.querySelector<HTMLElement>(PUSHED_SCREEN), 'the pushed screen')

const edgeOfTheChat = () =>
  present(document.querySelector('[data-slot="edge-back"]'), "the chat's edge")

const swipesPartWay = Effect.fn('swipesPartWay')(function* () {
  const edge = edgeOfTheChat()

  fireEvent.pointerDown(edge, { clientX: 0, clientY: 300, pointerId: 1 })
  yield* wait(SHORTER_THAN_AN_EXIT_MS)
  fireEvent.pointerMove(edge, { clientX: 30, clientY: 300, pointerId: 1 })
  yield* wait(SHORTER_THAN_AN_EXIT_MS)
  fireEvent.pointerMove(edge, { clientX: 60, clientY: 300, pointerId: 1 })
  yield* wait(SHORTER_THAN_AN_EXIT_MS)
})

const openChat = Effect.fn('openChat')(function* (title: string) {
  yield* click(present(cardOf(title), title))
  yield* findByRole('button', 'Back to Agents')
  yield* eventually(() => {
    expect(herdScreen().inert).toBe(true)
  })
})

const chatHasArrived = Effect.suspend(() =>
  eventually(() => {
    expect(pushedScreen().contains(document.activeElement)).toBe(true)
  }),
)

beforeEach(() => {
  stubMediaQueries([])
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(START.epochMilliseconds)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('the herd under a pushed screen', () => {
  it.effect('follows the herd under a chat that has arrived, with no animation left running', () =>
    Effect.gen(function* () {
      const { link } = yield* renderApp('/', liveWith(herd([laptop, desk('idle', ['Desk waits'])])))

      yield* eventually(() => {
        expect(herdTitles()).toContain('Desk waits')
      })
      yield* openChat('Port the herd screen')
      yield* chatHasArrived
      yield* SubscriptionRef.set(
        link.state,
        liveWith(herd([laptop, desk('blocked', ['Desk asks'])])),
      )
      yield* eventually(() => {
        expect(iconsOf('Desk asks')).toEqual(['blocked'])
      })

      expect(herdTitles()).not.toContain('Desk waits')
      expect(MotionGlobalConfig.instantAnimations).toBe(false)
    }),
  )

  it.effect('waits for a pause in typing before it renders what changed', () =>
    Effect.gen(function* () {
      const { link } = yield* renderApp('/', liveWith(herd([laptop, desk('idle', ['Desk waits'])])))

      yield* eventually(() => {
        expect(herdTitles()).toContain('Desk waits')
      })
      yield* openChat('Port the herd screen')
      yield* chatHasArrived
      window.dispatchEvent(new Event('input'))
      yield* SubscriptionRef.set(link.state, liveWith(herd([laptop, desk('idle', ['Desk asks'])])))
      yield* wait(SHORTER_THAN_AN_EXIT_MS)

      expect(herdTitles()).toContain('Desk waits')

      yield* wait(LONGER_THAN_A_TICK_MS)

      expect(herdTitles()).toContain('Desk asks')
    }),
  )

  it.effect('shows what changed during typing as soon as a back tap starts the slide', () =>
    Effect.gen(function* () {
      const { link } = yield* renderApp('/', liveWith(herd([laptop, desk('idle', ['Desk waits'])])))

      yield* eventually(() => {
        expect(herdTitles()).toContain('Desk waits')
      })
      yield* openChat('Port the herd screen')
      yield* chatHasArrived
      window.dispatchEvent(new Event('input'))
      yield* SubscriptionRef.set(link.state, liveWith(herd([laptop, desk('idle', ['Desk asks'])])))
      yield* click(yield* findByRole('button', 'Back to Agents'))

      expect(herdTitles()).toContain('Desk asks')
      expect(herdTitles()).not.toContain('Desk waits')
      expect(document.querySelector(PUSHED_SCREEN)).not.toBeNull()
    }),
  )

  it.effect('lands a status held for typing at once when a back tap shows it', () =>
    Effect.gen(function* () {
      const { link } = yield* renderApp('/', liveWith(herd([laptop, desk('idle', ['Desk waits'])])))

      yield* eventually(() => {
        expect(herdTitles()).toContain('Desk waits')
      })
      yield* openChat('Port the herd screen')
      yield* chatHasArrived
      window.dispatchEvent(new Event('input'))
      yield* SubscriptionRef.set(
        link.state,
        liveWith(herd([laptop, desk('blocked', ['Desk waits'])])),
      )
      yield* click(yield* findByRole('button', 'Back to Agents'))
      yield* wait(SHORTER_THAN_AN_EXIT_MS)

      const landed = present(
        cardOf('Desk waits')?.querySelector<HTMLElement>('[data-status="blocked"]') ?? null,
        'the new status',
      )

      expect(landed.style.opacity).toBe('1')
    }),
  )

  it.effect('lands a status held for typing at once when a swipe shows it', () =>
    Effect.gen(function* () {
      const { link } = yield* renderApp('/', liveWith(herd([laptop, desk('idle', ['Desk waits'])])))

      yield* eventually(() => {
        expect(herdTitles()).toContain('Desk waits')
      })
      yield* openChat('Port the herd screen')
      yield* chatHasArrived
      window.dispatchEvent(new Event('input'))
      yield* SubscriptionRef.set(
        link.state,
        liveWith(herd([laptop, desk('blocked', ['Desk waits'])])),
      )
      yield* swipesPartWay()

      const landed = present(
        cardOf('Desk waits')?.querySelector<HTMLElement>('[data-status="blocked"]') ?? null,
        'the new status',
      )

      expect(landed.style.opacity).toBe('1')
    }),
  )

  it.effect('leaves the card that opened the chat in place while the herd moves under it', () =>
    Effect.gen(function* () {
      const { link } = yield* renderApp('/', liveWith(herd([laptop, desk('idle', ['Desk waits'])])))

      yield* eventually(() => {
        expect(herdTitles()).toContain('Desk waits')
      })

      const opener = present(cardOf('Port the herd screen'), 'the opener')

      yield* openChat('Port the herd screen')
      yield* chatHasArrived
      yield* SubscriptionRef.set(
        link.state,
        liveWith(herd([laptop, desk('blocked', ['Desk waits'])])),
      )
      yield* eventually(() => {
        expect(iconsOf('Desk waits')).toEqual(['blocked'])
      })

      expect(cardOf('Port the herd screen')).toBe(opener)
    }),
  )

  it.effect('holds what it shows while the chat slides over it', () =>
    Effect.gen(function* () {
      const { link } = yield* renderApp('/', liveWith(herd([laptop, desk('idle', ['Desk waits'])])))

      yield* eventually(() => {
        expect(herdTitles()).toContain('Desk waits')
      })
      yield* click(present(cardOf('Port the herd screen'), 'the card'))
      yield* findByRole('button', 'Back to Agents')
      yield* SubscriptionRef.set(link.state, liveWith(herd([laptop, desk('idle', ['Desk asks'])])))
      yield* wait(SHORTER_THAN_AN_EXIT_MS)

      expect(herdTitles()).toContain('Desk waits')
      expect(herdTitles()).not.toContain('Desk asks')
    }),
  )

  it.effect('shows the current time as soon as a back tap starts the slide', () =>
    Effect.gen(function* () {
      yield* renderApp('/', liveWith(herd([laptop])))

      yield* eventually(() => {
        expect(pillText('Port the herd screen')).toBe('Working 42s')
      })
      yield* openChat('Wire the hub link')
      yield* chatHasArrived
      vi.setSystemTime(DateTime.addDuration(START, Duration.seconds(5)).epochMilliseconds)
      yield* wait(LONGER_THAN_A_TICK_MS)

      expect(pillText('Port the herd screen')).toBe('Working 42s')

      yield* click(yield* findByRole('button', 'Back to Agents'))

      expect(pillText('Port the herd screen')).toBe('Working 47s')
      expect(document.querySelector(PUSHED_SCREEN)).not.toBeNull()
    }),
  )

  it.effect('runs its clocks while a swipe shows it, and stops them when the chat comes back', () =>
    Effect.gen(function* () {
      yield* renderApp('/', liveWith(herd([laptop])))

      yield* eventually(() => {
        expect(pillText('Port the herd screen')).toBe('Working 42s')
      })
      yield* openChat('Wire the hub link')
      yield* chatHasArrived
      vi.setSystemTime(DateTime.addDuration(START, Duration.seconds(5)).epochMilliseconds)
      yield* wait(LONGER_THAN_A_TICK_MS)
      yield* swipesPartWay()

      expect(pillText('Port the herd screen')).toBe('Working 47s')

      fireEvent.pointerUp(edgeOfTheChat(), { clientX: 60, clientY: 300, pointerId: 1 })
      yield* eventually(() => {
        expect(pushedScreen().style.transform).toBe('none')
      })
      yield* wait(SHORTER_THAN_AN_EXIT_MS)
      vi.setSystemTime(DateTime.addDuration(START, Duration.seconds(9)).epochMilliseconds)
      yield* wait(LONGER_THAN_A_TICK_MS)

      expect(pillText('Port the herd screen')).toBe('Working 47s')
    }),
  )

  it.effect('ticks every elapsed time on the page together while shown', () =>
    Effect.gen(function* () {
      yield* renderApp(
        '/',
        liveWith(
          herd([
            machine(LAPTOP, [
              agent('w1:p1', 'working', { title: 'Port the herd screen', secondsAgo: 42 }),
              agent('w1:p2', 'working', { title: 'Wire the hub link', secondsAgo: 7 }),
            ]),
          ]),
        ),
      )

      yield* eventually(() => {
        expect(pillText('Wire the hub link')).toBe('Working 7s')
      })
      vi.setSystemTime(DateTime.addDuration(START, Duration.seconds(5)).epochMilliseconds)
      yield* wait(LONGER_THAN_A_TICK_MS)

      expect([pillText('Port the herd screen'), pillText('Wire the hub link')]).toEqual([
        'Working 47s',
        'Working 12s',
      ])
    }),
  )

  it.effect('stops its clocks while covered and shows the current time once uncovered', () =>
    Effect.gen(function* () {
      const { router } = yield* renderApp('/', liveWith(herd([laptop])))

      yield* eventually(() => {
        expect(pillText('Port the herd screen')).toBe('Working 42s')
      })
      yield* openChat('Wire the hub link')
      vi.setSystemTime(DateTime.addDuration(START, Duration.seconds(5)).epochMilliseconds)
      yield* wait(LONGER_THAN_A_TICK_MS)

      expect(pillText('Port the herd screen')).toBe('Working 42s')

      router.history.back()
      yield* eventually(() => {
        expect(herdScreen().inert).toBe(false)
      })

      expect(pillText('Port the herd screen')).toBe('Working 47s')
    }),
  )

  it.effect('lands what changed while covered without playing its animations', () =>
    Effect.gen(function* () {
      const { router, link } = yield* renderApp(
        '/',
        liveWith(herd([laptop, desk('idle', ['Desk waits', 'Desk leaves'])])),
      )

      yield* eventually(() => {
        expect(herdTitles()).toContain('Desk leaves')
      })
      yield* openChat('Port the herd screen')
      yield* SubscriptionRef.set(
        link.state,
        liveWith(herd([laptop, desk('blocked', ['Desk waits'])])),
      )
      router.history.back()
      yield* eventually(() => {
        expect(iconsOf('Desk waits')).toContain('blocked')
      })
      yield* wait(SHORTER_THAN_AN_EXIT_MS)

      expect(iconsOf('Desk waits')).toEqual(['blocked'])
      expect(herdTitles()).not.toContain('Desk leaves')
      expect(MotionGlobalConfig.instantAnimations).toBe(false)
      expect(rootProjectionNode.current?.isUpdateBlocked()).toBe(false)
    }),
  )
})
