import { describe, expect, it } from '@effect/vitest'
import { fireEvent, screen, within } from '@testing-library/react'
import * as Arr from 'effect/Array'
import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import * as Ref from 'effect/Ref'
import { afterEach, beforeEach, vi } from 'vitest'

import { CrookVersion } from '@crook/domain/CrookVersion'
import { HerdView } from '@crook/domain/HerdView'
import type { HerdMachine } from '@crook/domain/HerdView'
import { HubStorageFailed } from '@crook/protocol/ClientApi'
import { PLUGIN_INSTALL_COMMAND, TOKEN_CONTEXT } from '@crook/web/machines/AddMachineSheet'
import { ANNOUNCED, UNREACHABLE } from '@crook/web/rpc/HubLinkState'

import { liveWith, renderApp, stateWith } from '../AppRender.tsx'
import { afterSpring, click, dragX, eventually, findByRole, present } from '../Dom.ts'
import { agent, DESK, herd, LAPTOP, machine, START } from '../HerdFixtures.ts'
import { stubMediaQueries } from '../MediaQueries.ts'

const viewOf = (machines: readonly HerdMachine[]) =>
  new HerdView({ machines, hubVersion: CrookVersion.make('0.1.0') })

const laptop = machine(
  LAPTOP,
  [agent('w1:p1', 'blocked'), agent('w1:p2', 'working'), agent('w1:p3', 'done')],
  { agentVersion: '0.0.9', herdrVersion: '0.9.5' },
)

const desk = machine(DESK, [], {
  connection: 'offline',
  agentVersion: '0.1.0',
  herdrVersion: '0.9.5',
})

const codeShownIn = (container: HTMLElement) =>
  Arr.map(
    Array.from(container.querySelectorAll('[data-slot="code-block-code"]')),
    (block) => block.textContent,
  )

const cardOf = (label: string): HTMLElement =>
  Option.getOrThrowWith(
    Arr.findFirst(screen.getAllByText(label), (element) =>
      Option.fromNullishOr(element.closest<HTMLElement>('[data-slot="machine-card"]')),
    ),
    () => new Error(`No machine card shows ${label}.`),
  )

const swipeCardOf = (label: string) =>
  present(cardOf(label).closest('[data-slot="swipe-card"]'), `The swipe card of ${label}`)

beforeEach(() => {
  stubMediaQueries(['(prefers-reduced-motion)'])
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(START.epochMilliseconds)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('MachinesScreen', () => {
  it.effect('shows one card per machine with its status, counts, versions and update pill', () =>
    Effect.gen(function* () {
      yield* renderApp('/machines', liveWith(viewOf([laptop, desk])))

      expect((yield* findByRole('heading', 'Machines')).tagName).toBe('H1')

      const laptopCard = within(cardOf('laptop'))
      const deskCard = within(cardOf('desk'))

      expect(laptopCard.getByText('online')).toBeDefined()
      expect(laptopCard.getByText('3 agents · 2 need you')).toBeDefined()
      expect(laptopCard.getByText('agent 0.0.9 · herdr 0.9.5')).toBeDefined()
      expect(laptopCard.getByText('update agent')).toBeDefined()
      expect(deskCard.getByText('offline · 2h ago')).toBeDefined()
      expect(deskCard.getByText('Swipe to forget, or wait for it to reconnect')).toBeDefined()
      expect(deskCard.queryByText('update agent')).toBeNull()
    }),
  )

  it.effect('opens a machine on tap', () =>
    Effect.gen(function* () {
      const { router } = yield* renderApp('/machines', liveWith(viewOf([laptop])))

      yield* click(yield* Effect.promise(() => screen.findByText('3 agents · 2 need you')))
      yield* eventually(() => {
        expect(router.state.location.pathname).toBe('/machines/laptop')
      })

      expect((yield* findByRole('heading', 'laptop')).hasAttribute('data-screen-title')).toBe(true)
    }),
  )

  it.effect('offers Forget on an offline card and forgets it', () =>
    Effect.gen(function* () {
      const { link } = yield* renderApp('/machines', liveWith(viewOf([laptop, desk])))

      yield* Effect.promise(() => screen.findByText('Swipe to forget, or wait for it to reconnect'))

      expect(within(cardOf('laptop')).queryByText('Forget')).toBeNull()

      fireEvent.click(screen.getByRole('button', { name: 'Forget', hidden: true }))

      yield* eventually(() => {
        expect(Ref.getUnsafe(link.forgotten)).toEqual([DESK])
      })
    }),
  )

  it.effect('says why a forget failed in a toast, moving no card', () =>
    Effect.gen(function* () {
      const { link } = yield* renderApp('/machines', liveWith(viewOf([desk])))
      const refusal = new HubStorageFailed({ detail: 'disk full' })

      yield* Ref.set(link.forgetRefusal, Option.some(refusal))
      yield* Effect.promise(() => screen.findByText('Swipe to forget, or wait for it to reconnect'))
      fireEvent.click(screen.getByRole('button', { name: 'Forget', hidden: true }))

      const shown = yield* Effect.promise(() => screen.findByText(refusal.message))

      expect(shown.closest('[data-slot="toast"]')).not.toBeNull()
      expect(present(cardOf('desk').closest('li'), 'The desk row').textContent).not.toContain(
        refusal.message,
      )
    }),
  )

  it.effect('disables Forget while the hub cannot act, and dims the list', () =>
    Effect.gen(function* () {
      yield* renderApp('/machines', stateWith(UNREACHABLE, Option.some(viewOf([desk]))))

      yield* Effect.promise(() => screen.findByText('Swipe to forget, or wait for it to reconnect'))

      expect(
        screen.getByRole('button', { name: 'Forget', hidden: true }).hasAttribute('disabled'),
      ).toBe(true)
      expect(document.querySelector('[data-state="dimmed"]')).not.toBeNull()
    }),
  )

  it.effect('shows the empty state and the setup steps in a sheet', () =>
    Effect.gen(function* () {
      yield* renderApp('/machines', liveWith(herd([])))

      expect((yield* Effect.promise(() => screen.findByText('No machines yet'))).tagName).toBe('P')

      yield* click(
        within(
          present(
            screen.getByText('No machines yet').closest('[data-slot="empty-state"]'),
            'The empty state',
          ),
        ).getByRole('button', { name: 'Add a machine' }),
      )
      const sheet = yield* Effect.promise(() => screen.findByRole('dialog'))

      expect(within(sheet).getByText('Add a machine')).toBeDefined()
      expect(codeShownIn(sheet)).toEqual([
        PLUGIN_INSTALL_COMMAND,
        new URL('/rpc/agent', window.location.href).href.replace(/^http/u, 'ws'),
        TOKEN_CONTEXT,
      ])
      expect(
        within(sheet).getByText('It shows up under Machines as soon as it connects.'),
      ).toBeDefined()
    }),
  )

  it.effect('opens the setup sheet from the header', () =>
    Effect.gen(function* () {
      yield* renderApp('/machines', liveWith(viewOf([laptop])))

      yield* click(yield* findByRole('button', 'Add a machine'))

      expect(codeShownIn(yield* Effect.promise(() => screen.findByRole('dialog')))).toContain(
        PLUGIN_INSTALL_COMMAND,
      )
    }),
  )

  it.effect('offers Add a machine on the Agents tab when there are none', () =>
    Effect.gen(function* () {
      yield* renderApp('/', liveWith(herd([])))

      yield* click(yield* findByRole('button', 'Add a machine'))

      expect(codeShownIn(yield* Effect.promise(() => screen.findByRole('dialog')))).toContain(
        PLUGIN_INSTALL_COMMAND,
      )
    }),
  )

  it.effect(
    'stops standing in for the machines once the hub is unreachable with nothing cached',
    () =>
      Effect.gen(function* () {
        yield* renderApp('/machines', stateWith(UNREACHABLE, Option.none()))

        expect(
          yield* Effect.promise(() => screen.findByText('No machines on this phone yet')),
        ).toBeDefined()
        expect(screen.queryByText('Loading your machines')).toBeNull()
      }),
  )

  it.effect('stops standing in for a machine once the hub is unreachable with nothing cached', () =>
    Effect.gen(function* () {
      yield* renderApp('/machines/laptop', stateWith(UNREACHABLE, Option.none()))

      expect(
        yield* Effect.promise(() =>
          screen.findByText('Nothing about this machine on this phone yet'),
        ),
      ).toBeDefined()
      expect(screen.queryByText('Loading the machine')).toBeNull()
    }),
  )

  it.effect('shows skeleton cards on a first load', () =>
    Effect.gen(function* () {
      yield* renderApp('/machines', stateWith(ANNOUNCED, Option.none()))

      expect(
        (yield* Effect.promise(() => screen.findByText('Loading your machines'))).closest(
          '[role="status"]',
        ),
      ).not.toBeNull()
    }),
  )
})

describe('MachinesScreen swipe', () => {
  beforeEach(() => {
    stubMediaQueries([])
  })

  it.effect('swipes an offline card open to reveal Forget', () =>
    Effect.gen(function* () {
      yield* renderApp('/machines', liveWith(viewOf([desk])))
      yield* Effect.promise(() => screen.findByText('Swipe to forget, or wait for it to reconnect'))
      yield* dragX(swipeCardOf('desk'), [200, 190, 180, 170, 160, 150])

      yield* afterSpring(() => {
        expect(
          screen.getByRole('button', { name: 'Forget', hidden: true }).parentElement,
        ).toHaveProperty('inert', false)
      })
    }),
  )
})
