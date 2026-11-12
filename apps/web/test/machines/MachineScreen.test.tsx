import { describe, expect, it } from '@effect/vitest'
import { fireEvent, screen, within } from '@testing-library/react'
import * as DateTime from 'effect/DateTime'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import * as Ref from 'effect/Ref'
import * as SubscriptionRef from 'effect/SubscriptionRef'
import { afterEach, beforeEach, vi } from 'vitest'

import { CrookVersion } from '@crook/domain/CrookVersion'
import { HerdView } from '@crook/domain/HerdView'
import type { HerdMachine } from '@crook/domain/HerdView'
import { HubStorageFailed, MachineStillConnected } from '@crook/protocol/ClientApi'

import { liveWith, renderApp } from '../AppRender.tsx'
import { click, eventually, findByRole, present, springSettles } from '../Dom.ts'
import { agent, DESK, LAPTOP, machine, START } from '../HerdFixtures.ts'
import { stubMediaQueries } from '../MediaQueries.ts'

const viewOf = (machines: readonly HerdMachine[]) =>
  new HerdView({ machines, hubVersion: CrookVersion.make('0.1.0') })

const laptop = machine(
  LAPTOP,
  [
    agent('w1:p1', 'working', { title: 'Port the herd screen' }),
    agent('w1:p2', 'blocked', { title: 'Wire the hub link' }),
  ],
  { agentVersion: '0.0.9', herdrVersion: '0.9.5' },
)

const desk = machine(DESK, [agent('w2:p1', 'working', { title: 'Hidden while offline' })], {
  connection: 'offline',
  agentVersion: '0.1.0',
})

const OFFLINE_HINT = 'Swipe to forget, or wait for it to reconnect'
const FORGET_OUTLASTS_THE_PRESS = Duration.millis(1400)

const UNKNOWN_MACHINE =
  "crook doesn't know this machine. A forgotten machine comes back once its agent connects again."

const about = () =>
  within(
    present(screen.getByRole('heading', { name: 'About' }).closest('section'), 'The About section'),
  )

const valueOf = (label: string) => about().getByText(label).nextElementSibling?.textContent

beforeEach(() => {
  stubMediaQueries(['(prefers-reduced-motion)'])
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(DateTime.addDuration(START, Duration.minutes(5)).epochMilliseconds)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('MachineScreen', () => {
  it.effect('shows the machine with its agents as herd cards and its details', () =>
    Effect.gen(function* () {
      yield* renderApp('/machines/laptop', liveWith(viewOf([laptop, desk])))
      const title = yield* findByRole('heading', 'laptop')
      const header = within(present(title.closest('header'), 'The machine header'))

      expect(header.getByText('online')).toBeDefined()
      expect(header.getByText('update agent')).toBeDefined()
      expect(screen.getByRole('heading', { name: 'Agents · 2' })).toBeDefined()
      expect(
        Array.from(
          document.querySelectorAll('[data-slot="agent-title"]'),
          (element) => element.textContent,
        ),
      ).toEqual(['Wire the hub link', 'Port the herd screen'])
      expect(valueOf('Online for')).toBe('5m')
      expect(valueOf('crook agent')).toBe('0.0.9, hub has 0.1.0')
      expect(valueOf('Herdr')).toBe('0.9.5')
      expect(valueOf('Machine id')).toBe('laptop')
      expect(screen.queryByRole('button', { name: /Hold to forget/u })).toBeNull()
      expect(screen.getByRole('button', { name: 'Back to machines' })).toBeDefined()
    }),
  )

  it.effect("opens an agent's chat over this screen, and Back returns to its card", () =>
    Effect.gen(function* () {
      const { router } = yield* renderApp('/machines/laptop', liveWith(viewOf([laptop])))
      const card = present(
        (yield* Effect.promise(() => screen.findByText('Wire the hub link'))).closest('button'),
        'The card',
      )

      yield* click(card)
      yield* eventually(() => {
        expect(router.state.location.pathname).toBe('/machines/laptop/p/w1%3Ap2')
      })

      expect(
        screen.getByRole('heading', { name: 'laptop', hidden: true }).closest('[inert]'),
      ).not.toBeNull()
      expect(document.querySelector('[data-slot="herd-list"]')).toBeNull()

      yield* click(yield* findByRole('button', 'Back to laptop'))
      yield* eventually(() => {
        expect(router.state.location.pathname).toBe('/machines/laptop')
      })

      expect(document.activeElement).toBe(card)
    }),
  )

  it.effect('opens a chat linked under this machine over it, and Back lands here', () =>
    Effect.gen(function* () {
      const { router } = yield* renderApp('/machines/laptop/p/w1%3Ap2', liveWith(viewOf([laptop])))

      yield* click(yield* findByRole('button', 'Back to laptop'))
      yield* eventually(() => {
        expect(router.state.location.pathname).toBe('/machines/laptop')
      })

      expect(router.history.canGoBack()).toBe(false)
      expect(screen.getByRole('button', { name: 'Back to machines' })).toBeDefined()
    }),
  )

  it.effect('says it cannot see the agents when herdr went before any were on record', () =>
    Effect.gen(function* () {
      const started = machine(LAPTOP, [], { herdrLostAt: START })

      yield* renderApp('/machines/laptop', liveWith(viewOf([started])))

      expect(yield* findByRole('heading', 'Agents')).toBeDefined()
      expect(screen.getByText("Can't see this machine's agents while herdr is away")).toBeDefined()
      expect(screen.queryByText(/No agents running/u)).toBeNull()
    }),
  )

  it.effect('leaves the gap between the header words wider than a dot to its own word', () =>
    Effect.gen(function* () {
      yield* renderApp('/machines/laptop', liveWith(viewOf([laptop])))
      const title = yield* findByRole('heading', 'laptop')
      const header = present(title.closest('header'), 'The machine header')
      const words = present(header.querySelector('[data-slot="status-pill"]'), 'A status word')

      expect(words.parentElement?.className).toContain('gap-2')
    }),
  )

  it.effect('opens the chat of a row kept while herdr is lost', () =>
    Effect.gen(function* () {
      const kept = machine(LAPTOP, [agent('w1:p2', 'working', { title: 'Wire the hub link' })], {
        herdrLostAt: START,
      })
      const { router } = yield* renderApp('/machines/laptop', liveWith(viewOf([kept])))

      const title = yield* Effect.promise(() => screen.findByText('Wire the hub link'))

      expect(title.closest('[data-kept]')).not.toBeNull()

      yield* click(title)
      yield* eventually(() => {
        expect(router.state.location.pathname).toBe('/machines/laptop/p/w1%3Ap2')
      })
    }),
  )

  it.effect('hides the agents of an offline machine and offers Hold to forget', () =>
    Effect.gen(function* () {
      const { router, link } = yield* renderApp('/machines', liveWith(viewOf([laptop, desk])))

      yield* click(yield* Effect.promise(() => screen.findByText(OFFLINE_HINT)))
      yield* eventually(() => {
        expect(router.state.location.pathname).toBe('/machines/desk')
      })

      expect((yield* findByRole('heading', 'Agents')).tagName).toBe('H2')
      expect(
        screen.getByText('Offline, so its agents are unknown until it reconnects.'),
      ).toBeDefined()
      expect(screen.queryByText('Hidden while offline')).toBeNull()
      expect(valueOf('Last seen')).toBe('2h ago')
      expect(valueOf('crook agent')).toBe('0.1.0')
      expect(valueOf('Herdr')).toBe('unknown')
      expect(
        screen.getByText('It comes back on its own if its agent connects again.'),
      ).toBeDefined()

      fireEvent.click(screen.getByRole('button', { name: 'Hold to forget desk' }))

      yield* eventually(() => {
        expect(Ref.getUnsafe(link.forgotten)).toEqual([DESK])
      })
      yield* SubscriptionRef.set(link.state, liveWith(viewOf([laptop])))
      yield* eventually(() => {
        expect(router.state.location.pathname).toBe('/machines')
      })
    }),
  )

  it.effect('says why a forget failed and stays on the machine', () =>
    Effect.gen(function* () {
      const { router, link } = yield* renderApp('/machines/desk', liveWith(viewOf([laptop, desk])))
      const refusal = new HubStorageFailed({ detail: 'disk full' })

      yield* Ref.set(link.forgetRefusal, Option.some(refusal))
      fireEvent.click(yield* findByRole('button', 'Hold to forget desk'))

      expect((yield* Effect.promise(() => screen.findByRole('alert'))).textContent).toBe(
        refusal.message,
      )
      expect(router.state.location.pathname).toBe('/machines/desk')
    }),
  )

  it.effect('drops a refusal once the machine has come back and gone again', () =>
    Effect.gen(function* () {
      const { link } = yield* renderApp('/machines/desk', liveWith(viewOf([laptop, desk])))
      const refusal = new MachineStillConnected({ machine: DESK, connection: 'reconnecting' })

      yield* Ref.set(link.forgetRefusal, Option.some(refusal))
      fireEvent.click(yield* findByRole('button', 'Hold to forget desk'))

      expect((yield* Effect.promise(() => screen.findByRole('alert'))).textContent).toBe(
        refusal.message,
      )

      yield* SubscriptionRef.set(
        link.state,
        liveWith(viewOf([laptop, machine(DESK, [], { connection: 'online' })])),
      )
      yield* eventually(() => {
        expect(screen.queryByRole('button', { name: /Hold to forget/u })).toBeNull()
      })
      yield* SubscriptionRef.set(link.state, liveWith(viewOf([laptop, desk])))

      expect(yield* findByRole('button', 'Hold to forget desk')).toBeDefined()
      expect(screen.queryByRole('alert')).toBeNull()
    }),
  )

  it.live('keeps saying it is forgetting for as long as the hub takes', () =>
    Effect.gen(function* () {
      const { router, link } = yield* renderApp('/', liveWith(viewOf([laptop, desk])))

      yield* Effect.promise(() => router.navigate({ to: '/machines' }))
      yield* link.forgetAnswers.close
      yield* click(yield* Effect.promise(() => screen.findByText(OFFLINE_HINT)))
      fireEvent.click(yield* findByRole('button', 'Hold to forget desk'))
      const holdButton = () =>
        present(document.querySelector('[data-slot="forget-machine"] button'), 'Hold to forget')

      yield* eventually(() => {
        expect(holdButton().textContent).toContain('Forgetting…')
      })
      yield* Effect.sleep(FORGET_OUTLASTS_THE_PRESS)

      expect(holdButton().textContent).toContain('Forgetting…')
      expect(holdButton().hasAttribute('disabled')).toBe(true)

      yield* link.forgetAnswers.open
    }),
  )

  it.effect('stays where Back went when a slow forget lands', () =>
    Effect.gen(function* () {
      const { router, link } = yield* renderApp('/', liveWith(viewOf([laptop, desk])))

      yield* Effect.promise(() => router.navigate({ to: '/machines' }))
      yield* link.forgetAnswers.close
      yield* click(yield* Effect.promise(() => screen.findByText(OFFLINE_HINT)))
      fireEvent.click(yield* findByRole('button', 'Hold to forget desk'))
      yield* eventually(() => {
        expect(
          present(
            document.querySelector('[data-slot="forget-machine"] button'),
            'Hold to forget',
          ).hasAttribute('disabled'),
        ).toBe(true)
      })
      yield* click(screen.getByRole('button', { name: 'Back to machines' }))
      yield* eventually(() => {
        expect(router.state.location.pathname).toBe('/machines')
      })
      yield* link.forgetAnswers.open
      yield* eventually(() => {
        expect(Ref.getUnsafe(link.forgotten)).toEqual([DESK])
      })
      yield* springSettles

      expect(router.state.location.pathname).toBe('/machines')
    }),
  )

  it.effect('says so when the machine leaves the herd while it is open', () =>
    Effect.gen(function* () {
      const { router, link } = yield* renderApp('/machines/desk', liveWith(viewOf([laptop, desk])))

      yield* findByRole('button', 'Hold to forget desk')
      yield* SubscriptionRef.set(link.state, liveWith(viewOf([laptop])))

      expect((yield* Effect.promise(() => screen.findByText(UNKNOWN_MACHINE))).tagName).toBe('P')
      expect(screen.queryByRole('button', { name: /Hold to forget/u })).toBeNull()
      expect(screen.getByRole('heading', { name: 'desk' })).toBeDefined()
      expect(router.state.location.pathname).toBe('/machines/desk')
    }),
  )

  it.effect('says when it does not know the machine', () =>
    Effect.gen(function* () {
      yield* renderApp('/machines/gone', liveWith(viewOf([laptop])))

      expect((yield* Effect.promise(() => screen.findByText(UNKNOWN_MACHINE))).tagName).toBe('P')
    }),
  )
})
