import { describe, expect, it } from '@effect/vitest'
import { fireEvent, screen, within } from '@testing-library/react'
import * as DateTime from 'effect/DateTime'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Ref from 'effect/Ref'
import * as SubscriptionRef from 'effect/SubscriptionRef'
import { afterEach, beforeEach, vi } from 'vitest'

import { CrookVersion } from '@crook/domain/CrookVersion'
import { HerdView } from '@crook/domain/HerdView'
import type { HerdMachine } from '@crook/domain/HerdView'

import { liveWith, renderApp } from '../AppRender.tsx'
import { click, eventually, findByRole } from '../Dom.ts'
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

const about = () =>
  within(screen.getByRole('heading', { name: 'About' }).closest('section') ?? document.body)

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
      const header = within(title.closest('header') ?? document.body)

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

  it.effect("opens an agent's chat from its card", () =>
    Effect.gen(function* () {
      const { router } = yield* renderApp('/machines/laptop', liveWith(viewOf([laptop])))

      yield* click(yield* Effect.promise(() => screen.findByText('Wire the hub link')))
      yield* eventually(() => {
        expect(router.state.location.pathname).toBe('/m/laptop/p/w1%3Ap2')
      })
    }),
  )

  it.effect('hides the agents of an offline machine and offers Hold to forget', () =>
    Effect.gen(function* () {
      const { router, link } = yield* renderApp('/machines', liveWith(viewOf([laptop, desk])))

      yield* click(
        yield* Effect.promise(() =>
          screen.findByText('Swipe to forget, or wait for it to reconnect'),
        ),
      )
      yield* eventually(() => {
        expect(router.state.location.pathname).toBe('/machines/desk')
      })

      expect((yield* findByRole('heading', 'Agents · –')).tagName).toBe('H2')
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

  it.effect('says when it does not know the machine', () =>
    Effect.gen(function* () {
      yield* renderApp('/machines/gone', liveWith(viewOf([laptop])))

      expect(
        (yield* Effect.promise(() =>
          screen.findByText(
            "crook doesn't know this machine. A forgotten machine comes back once its agent connects again.",
          ),
        )).tagName,
      ).toBe('P')
    }),
  )
})
