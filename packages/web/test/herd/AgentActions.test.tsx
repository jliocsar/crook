import { describe, expect, it } from '@effect/vitest'
import { fireEvent, screen, within } from '@testing-library/react'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import type * as AtomRegistry from 'effect/reactivity/AtomRegistry'
import * as Ref from 'effect/Ref'
import * as SubscriptionRef from 'effect/SubscriptionRef'
import { afterEach, beforeEach, vi } from 'vitest'

import { ClosePane, RenameAgent } from '@crook/domain/Command'
import type { AgentRow } from '@crook/domain/AgentRow'
import { HubStorageFailed } from '@crook/protocol/ClientApi'
import {
  CommandDeliveryUnknown,
  CommandTimedOut,
  PaneNotCreatedByCrook,
} from '@crook/protocol/Commands'
import { ActionsIntent, agentActionsAtom, PaneAddress } from '@crook/web/atoms/AgentActions'
import { LinkStatus } from '@crook/web/rpc/HubLinkState'

import { liveWith, renderApp, stateWith } from '../AppRender.tsx'
import { afterSpring, click, dragX, eventually, findByRole, present } from '../Dom.ts'
import { agent, herd, LAPTOP, machine, START } from '../HerdFixtures.ts'
import type { SentCommand } from '../HubFakes.ts'
import { stubMediaQueries } from '../MediaQueries.ts'

const porting = agent('w1:p1', 'working', {
  title: 'Port the herd screen',
  secondsAgo: 42,
  createdByCrook: true,
})
const wiring = agent('w1:p2', 'blocked', { title: 'Wire the hub link', secondsAgo: 180 })
const banner = agent('w1:p3', 'idle', { title: 'Write the banner', createdByCrook: true })

const laptopWith = (
  agents: readonly AgentRow[],
  options: { readonly pinned?: readonly string[]; readonly shellPanes?: readonly string[] } = {},
) => machine(LAPTOP, agents, options)

const everyone = laptopWith([porting, wiring, banner])

const cardTitles = () =>
  Array.from(document.querySelectorAll('[data-slot="agent-title"]'), (title) => title.textContent)

const cardButton = (title: string): HTMLElement =>
  present(
    screen
      .getAllByText(title)
      .map((element) => element.closest<HTMLElement>('[data-slot="swipe-card"] button'))
      .find((button) => button !== null),
    `The card for ${title}`,
  )

const openSheetOn = Effect.fn('openSheetOn')(function* (title: string) {
  yield* Effect.promise(() => screen.findAllByText(title))
  fireEvent.contextMenu(cardButton(title))

  return yield* Effect.promise(() => screen.findByRole('dialog'))
})

const sheetGone = eventually(() => {
  expect(screen.queryByRole('dialog')).toBeNull()
})

const dismissSheet = (sheet: HTMLElement) => {
  fireEvent.keyDown(sheet, { key: 'Escape' })
}

const openFromChat = (registry: AtomRegistry.AtomRegistry) => {
  registry.set(
    agentActionsAtom,
    ActionsIntent.Open({
      agent: new PaneAddress({ machine: LAPTOP, pane: porting.pane }),
      origin: 'chat',
    }),
  )
}

const sentCommands = (link: { readonly commands: Ref.Ref<readonly SentCommand[]> }) =>
  Ref.getUnsafe(link.commands).map((sent) => sent.command)

beforeEach(() => {
  stubMediaQueries(['(prefers-reduced-motion)'])
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(START.epochMilliseconds)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('herd card markers', () => {
  it.effect('puts a pinned agent first and marks it pinned', () =>
    Effect.gen(function* () {
      yield* renderApp(
        '/',
        liveWith(herd([laptopWith([porting, wiring, banner], { pinned: ['w1:p3'] })])),
      )
      const marker = yield* findByRole('img', 'Pinned')

      expect(cardTitles()).toEqual([
        'Write the banner',
        'Wire the hub link',
        'Port the herd screen',
      ])
      expect(marker.closest('[data-slot="agent-card"]')?.textContent).toContain('Write the banner')
      expect(screen.getAllByRole('img', { name: 'Pinned' })).toHaveLength(1)
    }),
  )
})

describe('the action sheet', () => {
  it.effect('opens on a long press with the agent and where it runs', () =>
    Effect.gen(function* () {
      yield* renderApp('/', liveWith(herd([everyone])))
      yield* Effect.promise(() => screen.findByText('Port the herd screen'))
      const card = cardButton('Port the herd screen')

      fireEvent.pointerDown(card, { button: 0, clientX: 10, clientY: 10 })
      yield* Effect.promise(() =>
        vi.waitFor(
          () => {
            expect(screen.queryByRole('dialog')).not.toBeNull()
          },
          { timeout: Duration.toMillis(Duration.seconds(2)) },
        ),
      )
      fireEvent.pointerUp(card)
      const sheet = screen.getByRole('dialog')

      expect(within(sheet).getByRole('heading', { name: 'Port the herd screen' })).toBeDefined()
      expect(within(sheet).getByText('laptop · crook · web')).toBeDefined()
      expect(within(sheet).getByRole('button', { name: 'Rename' })).toBeDefined()
      expect(within(sheet).getByRole('button', { name: 'Pin to top' })).toBeDefined()
      expect(within(sheet).getByRole('button', { name: 'Hold to close agent' })).toBeDefined()
    }),
  )

  it.effect('renames inline and closes once the herd carries the new name', () =>
    Effect.gen(function* () {
      const { link } = yield* renderApp('/', liveWith(herd([everyone])))
      const sheet = yield* openSheetOn('Port the herd screen')

      fireEvent.click(within(sheet).getByRole('button', { name: 'Rename' }))
      const field = within(sheet).getByRole('textbox', { name: 'Agent name' })

      expect(field).toHaveProperty('value', 'Port the herd screen')

      fireEvent.change(field, { target: { value: '  Herd port ' } })
      fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }))

      yield* eventually(() => {
        expect(sentCommands(link)).toEqual([
          new RenameAgent({ pane: porting.pane, label: Option.some('Herd port') }),
        ])
      })

      expect(within(sheet).getByRole('button', { name: 'Saving…' })).toBeDefined()

      yield* SubscriptionRef.set(
        link.state,
        liveWith(
          herd([
            laptopWith([
              agent('w1:p1', 'working', { title: 'Port the herd screen', label: 'Herd port' }),
              wiring,
              banner,
            ]),
          ]),
        ),
      )
      yield* sheetGone

      expect(cardTitles()).toContain('Herd port')
    }),
  )

  it.effect('refuses a name with control characters before sending anything', () =>
    Effect.gen(function* () {
      const { link } = yield* renderApp('/', liveWith(herd([everyone])))
      const sheet = yield* openSheetOn('Port the herd screen')

      fireEvent.click(within(sheet).getByRole('button', { name: 'Rename' }))
      fireEvent.change(within(sheet).getByRole('textbox', { name: 'Agent name' }), {
        target: { value: 'Herd\tport' },
      })
      fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }))

      expect(within(sheet).getByRole('alert').textContent).toContain('control characters')
      expect(sentCommands(link)).toEqual([])
    }),
  )

  it.effect('pins from the sheet and closes once the herd shows the pin', () =>
    Effect.gen(function* () {
      const { link } = yield* renderApp('/', liveWith(herd([everyone])))
      const sheet = yield* openSheetOn('Write the banner')

      fireEvent.click(within(sheet).getByRole('button', { name: 'Pin to top' }))

      yield* eventually(() => {
        expect(Ref.getUnsafe(link.pins)).toEqual([
          { machine: LAPTOP, pane: banner.pane, pinned: true },
        ])
      })
      yield* SubscriptionRef.set(
        link.state,
        liveWith(herd([laptopWith([porting, wiring, banner], { pinned: ['w1:p3'] })])),
      )
      yield* sheetGone

      expect(cardTitles()[0]).toBe('Write the banner')
    }),
  )

  it.effect('closes a pane crook created with a hold, and the card just goes', () =>
    Effect.gen(function* () {
      const { link } = yield* renderApp('/', liveWith(herd([everyone])))
      const sheet = yield* openSheetOn('Port the herd screen')

      expect(within(sheet).queryByText(/crook didn't open this pane/u)).toBeNull()

      fireEvent.click(within(sheet).getByRole('button', { name: 'Hold to close agent' }))

      yield* eventually(() => {
        expect(sentCommands(link)).toEqual([
          new ClosePane({ pane: porting.pane, confirmed: false }),
        ])
      })
      yield* SubscriptionRef.set(link.state, liveWith(herd([laptopWith([wiring, banner])])))
      yield* sheetGone

      expect(cardTitles()).not.toContain('Port the herd screen')
      expect(screen.queryByText('Pane closed')).toBeNull()
    }),
  )

  it.effect('words the hold as the confirmation on a pane crook did not create', () =>
    Effect.gen(function* () {
      const { link } = yield* renderApp('/', liveWith(herd([everyone])))
      const sheet = yield* openSheetOn('Wire the hub link')

      expect(within(sheet).getByText(/crook didn't open this pane/u)).toBeDefined()

      fireEvent.click(within(sheet).getByRole('button', { name: 'Hold to close anyway' }))

      yield* eventually(() => {
        expect(sentCommands(link)).toEqual([new ClosePane({ pane: wiring.pane, confirmed: true })])
      })
    }),
  )

  it.effect('asks for the confirmation when the agent says crook did not create the pane', () =>
    Effect.gen(function* () {
      const { link } = yield* renderApp('/', liveWith(herd([everyone])))

      yield* Ref.set(link.commandRefusals, [new PaneNotCreatedByCrook({ pane: porting.pane })])
      const sheet = yield* openSheetOn('Port the herd screen')

      fireEvent.click(within(sheet).getByRole('button', { name: 'Hold to close agent' }))
      yield* afterSpring(() => {
        expect(within(sheet).getByRole('button', { name: 'Hold to close anyway' })).toBeDefined()
      })
      const anyway = within(sheet).getByRole('button', { name: 'Hold to close anyway' })

      expect(within(sheet).getByText(/crook didn't open this pane/u)).toBeDefined()
      expect(within(sheet).queryByRole('alert')).toBeNull()

      fireEvent.click(anyway)

      yield* eventually(() => {
        expect(sentCommands(link)).toEqual([
          new ClosePane({ pane: porting.pane, confirmed: false }),
          new ClosePane({ pane: porting.pane, confirmed: true }),
        ])
      })
      const [first, second] = Ref.getUnsafe(link.commands)

      expect(second?.key).not.toBe(first?.key)
    }),
  )

  it.effect('says why a close failed and retries a timed-out one under the same key', () =>
    Effect.gen(function* () {
      const { link } = yield* renderApp('/', liveWith(herd([everyone])))
      const timedOut = new CommandTimedOut({ machine: LAPTOP, timeout: Duration.seconds(10) })

      yield* Ref.set(link.commandRefusals, [timedOut])
      const sheet = yield* openSheetOn('Port the herd screen')

      fireEvent.click(within(sheet).getByRole('button', { name: 'Hold to close agent' }))

      expect((yield* Effect.promise(() => within(sheet).findByRole('alert'))).textContent).toBe(
        timedOut.message,
      )

      yield* afterSpring(() => {
        expect(within(sheet).getByRole('button', { name: 'Hold to close agent' })).toBeDefined()
      })
      fireEvent.click(within(sheet).getByRole('button', { name: 'Hold to close agent' }))

      yield* eventually(() => {
        expect(Ref.getUnsafe(link.commands)).toHaveLength(2)
      })
      const [first, second] = Ref.getUnsafe(link.commands)

      expect(second?.key).toBe(first?.key)
    }),
  )

  it.effect('closes with a toast when the pane closes on its own, or Claude exits', () =>
    Effect.gen(function* () {
      const { link } = yield* renderApp('/', liveWith(herd([everyone])))

      yield* openSheetOn('Port the herd screen')
      yield* SubscriptionRef.set(link.state, liveWith(herd([laptopWith([wiring, banner])])))
      yield* sheetGone

      expect(
        (yield* Effect.promise(() => screen.findByText('Pane closed'))).closest(
          '[data-slot="toast"]',
        ),
      ).not.toBeNull()

      yield* openSheetOn('Write the banner')
      yield* SubscriptionRef.set(
        link.state,
        liveWith(herd([laptopWith([wiring], { shellPanes: ['w1:p3'] })])),
      )
      yield* sheetGone

      expect(yield* Effect.promise(() => screen.findByText('Claude exited'))).toBeDefined()
    }),
  )

  it.effect('keeps every action off while the hub cannot act', () =>
    Effect.gen(function* () {
      yield* renderApp('/', stateWith(LinkStatus.Unreachable(), Option.some(herd([everyone]))))
      const sheet = yield* openSheetOn('Port the herd screen')

      expect(within(sheet).getByRole('button', { name: 'Rename' })).toHaveProperty('disabled', true)
      expect(within(sheet).getByRole('button', { name: 'Pin to top' })).toHaveProperty(
        'disabled',
        true,
      )
      expect(within(sheet).getByRole('button', { name: 'Hold to close agent' })).toHaveProperty(
        'disabled',
        true,
      )
    }),
  )

  it.effect("opens on a machine's agents too", () =>
    Effect.gen(function* () {
      yield* renderApp('/machines/laptop', liveWith(herd([everyone])))
      const sheet = yield* openSheetOn('Wire the hub link')

      expect(within(sheet).getByRole('heading', { name: 'Wire the hub link' })).toBeDefined()
    }),
  )

  it.effect('goes back to the herd with a toast after a close started from the chat', () =>
    Effect.gen(function* () {
      const { router, link, registry } = yield* renderApp(
        '/m/laptop/p/w1%3Ap1',
        liveWith(herd([everyone])),
      )

      yield* findByRole('heading', 'Port the herd screen')
      openFromChat(registry)
      const sheet = yield* Effect.promise(() => screen.findByRole('dialog'))

      fireEvent.click(within(sheet).getByRole('button', { name: 'Hold to close agent' }))
      yield* eventually(() => {
        expect(sentCommands(link)).toHaveLength(1)
      })
      yield* SubscriptionRef.set(link.state, liveWith(herd([laptopWith([wiring, banner])])))

      yield* eventually(() => {
        expect(router.state.location.pathname).toBe('/')
      })

      expect(yield* Effect.promise(() => screen.findByText('Pane closed'))).toBeDefined()

      yield* eventually(() => {
        expect(document.activeElement?.textContent).toContain('Agents')
      })
    }),
  )
})

describe('the action sheet, while an action is out', () => {
  it.effect('keeps focus where the user moved it while the herd changes under the name field', () =>
    Effect.gen(function* () {
      const { link } = yield* renderApp('/', liveWith(herd([everyone])))
      const sheet = yield* openSheetOn('Port the herd screen')

      fireEvent.click(within(sheet).getByRole('button', { name: 'Rename' }))
      const field = within(sheet).getByRole('textbox', { name: 'Agent name' })

      yield* eventually(() => {
        expect(document.activeElement).toBe(field)
      })
      const pin = within(sheet).getByRole('button', { name: 'Pin to top' })

      pin.focus()
      yield* SubscriptionRef.set(
        link.state,
        liveWith(
          herd([
            laptopWith([
              porting,
              wiring,
              banner,
              agent('w1:p4', 'idle', { title: 'Draw the pin' }),
            ]),
          ]),
        ),
      )
      yield* eventually(() => {
        expect(cardTitles()).toContain('Draw the pin')
      })

      expect(document.activeElement).toBe(pin)
    }),
  )

  it.effect('holds Save and the Hold Button off while their answers are out', () =>
    Effect.gen(function* () {
      const { link } = yield* renderApp('/', liveWith(herd([everyone])))

      yield* link.commandAnswers.close
      const sheet = yield* openSheetOn('Port the herd screen')

      fireEvent.click(within(sheet).getByRole('button', { name: 'Rename' }))
      fireEvent.change(within(sheet).getByRole('textbox', { name: 'Agent name' }), {
        target: { value: 'Herd port' },
      })
      fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }))
      fireEvent.click(within(sheet).getByRole('button', { name: 'Hold to close agent' }))

      yield* eventually(() => {
        expect(sentCommands(link)).toHaveLength(2)
      })

      expect(within(sheet).getByRole('button', { name: 'Saving…' })).toHaveProperty(
        'disabled',
        true,
      )
      expect(within(sheet).getByRole('button', { name: /^Closing…/u })).toHaveProperty(
        'disabled',
        true,
      )
    }),
  )

  it.effect("shows the hub's refusal of a pin in the sheet", () =>
    Effect.gen(function* () {
      const { link } = yield* renderApp('/', liveWith(herd([everyone])))
      const refusal = new HubStorageFailed({ detail: 'disk full' })

      yield* Ref.set(link.pinRefusal, Option.some(refusal))
      const sheet = yield* openSheetOn('Write the banner')

      fireEvent.click(within(sheet).getByRole('button', { name: 'Pin to top' }))

      expect((yield* Effect.promise(() => within(sheet).findByRole('alert'))).textContent).toBe(
        refusal.message,
      )
    }),
  )

  it.effect('retries a confirmed close that timed out as confirmed, under the same key', () =>
    Effect.gen(function* () {
      const { link } = yield* renderApp('/', liveWith(herd([everyone])))
      const timedOut = new CommandTimedOut({ machine: LAPTOP, timeout: Duration.seconds(10) })

      yield* Ref.set(link.commandRefusals, [
        new PaneNotCreatedByCrook({ pane: porting.pane }),
        timedOut,
      ])
      const sheet = yield* openSheetOn('Port the herd screen')

      fireEvent.click(within(sheet).getByRole('button', { name: 'Hold to close agent' }))
      yield* afterSpring(() => {
        expect(within(sheet).getByRole('button', { name: 'Hold to close anyway' })).toBeDefined()
      })
      fireEvent.click(within(sheet).getByRole('button', { name: 'Hold to close anyway' }))

      expect((yield* Effect.promise(() => within(sheet).findByRole('alert'))).textContent).toBe(
        timedOut.message,
      )

      yield* afterSpring(() => {
        expect(within(sheet).getByRole('button', { name: 'Hold to close anyway' })).toBeDefined()
      })
      fireEvent.click(within(sheet).getByRole('button', { name: 'Hold to close anyway' }))

      yield* eventually(() => {
        expect(Ref.getUnsafe(link.commands)).toHaveLength(3)
      })
      const [, second, third] = Ref.getUnsafe(link.commands)

      expect(third?.command).toEqual(new ClosePane({ pane: porting.pane, confirmed: true }))
      expect(third?.key).toBe(second?.key)
    }),
  )

  it.effect('brings the sheet back with the reason when a close dismissed in flight fails', () =>
    Effect.gen(function* () {
      const { link } = yield* renderApp('/', liveWith(herd([everyone])))

      yield* Ref.set(link.commandRefusals, [new CommandDeliveryUnknown()])
      yield* link.commandAnswers.close
      const sheet = yield* openSheetOn('Port the herd screen')

      fireEvent.click(within(sheet).getByRole('button', { name: 'Hold to close agent' }))
      yield* eventually(() => {
        expect(sentCommands(link)).toHaveLength(1)
      })
      dismissSheet(sheet)
      yield* sheetGone
      yield* link.commandAnswers.open
      const back = yield* Effect.promise(() => screen.findByRole('dialog'))

      expect((yield* Effect.promise(() => within(back).findByRole('alert'))).textContent).toBe(
        new CommandDeliveryUnknown().message,
      )
    }),
  )

  it.effect('shows a close still out when the sheet it was dismissed from opens again', () =>
    Effect.gen(function* () {
      const { link } = yield* renderApp('/', liveWith(herd([everyone])))

      yield* link.commandAnswers.close
      const sheet = yield* openSheetOn('Port the herd screen')

      fireEvent.click(within(sheet).getByRole('button', { name: 'Hold to close agent' }))
      yield* eventually(() => {
        expect(sentCommands(link)).toHaveLength(1)
      })
      dismissSheet(sheet)
      yield* sheetGone
      const again = yield* openSheetOn('Port the herd screen')

      expect(within(again).getByRole('button', { name: /^Closing…/u })).toHaveProperty(
        'disabled',
        true,
      )

      yield* link.commandAnswers.open
      yield* SubscriptionRef.set(link.state, liveWith(herd([laptopWith([wiring, banner])])))
      yield* sheetGone

      expect(sentCommands(link)).toHaveLength(1)
    }),
  )

  it.effect('still goes back to the herd when a close from the chat is dismissed in flight', () =>
    Effect.gen(function* () {
      const { router, link, registry } = yield* renderApp(
        '/m/laptop/p/w1%3Ap1',
        liveWith(herd([everyone])),
      )

      yield* findByRole('heading', 'Port the herd screen')
      yield* link.commandAnswers.close
      openFromChat(registry)
      const sheet = yield* Effect.promise(() => screen.findByRole('dialog'))

      fireEvent.click(within(sheet).getByRole('button', { name: 'Hold to close agent' }))
      yield* eventually(() => {
        expect(sentCommands(link)).toHaveLength(1)
      })
      dismissSheet(sheet)
      yield* sheetGone
      yield* link.commandAnswers.open
      yield* SubscriptionRef.set(link.state, liveWith(herd([laptopWith([wiring, banner])])))

      yield* eventually(() => {
        expect(router.state.location.pathname).toBe('/')
      })

      expect(yield* Effect.promise(() => screen.findByText('Pane closed'))).toBeDefined()
    }),
  )

  it.effect('goes back through history to the herd the chat was opened from', () =>
    Effect.gen(function* () {
      const { router, link, registry } = yield* renderApp('/', liveWith(herd([everyone])))

      yield* click(yield* Effect.promise(() => screen.findByText('Port the herd screen')))
      yield* eventually(() => {
        expect(router.state.location.pathname).toBe('/m/laptop/p/w1%3Ap1')
      })
      openFromChat(registry)
      const sheet = yield* Effect.promise(() => screen.findByRole('dialog'))

      fireEvent.click(within(sheet).getByRole('button', { name: 'Hold to close agent' }))
      yield* eventually(() => {
        expect(sentCommands(link)).toHaveLength(1)
      })
      yield* SubscriptionRef.set(link.state, liveWith(herd([laptopWith([wiring, banner])])))

      yield* eventually(() => {
        expect(router.state.location.pathname).toBe('/')
      })

      expect(router.history.canGoBack()).toBe(false)
      expect(yield* Effect.promise(() => screen.findByText('Pane closed'))).toBeDefined()
    }),
  )
})

describe('swiping a card', () => {
  beforeEach(() => {
    stubMediaQueries([])
  })

  it.effect('reveals Pin and Close; Pin pins and Close opens the sheet', () =>
    Effect.gen(function* () {
      const { link } = yield* renderApp('/', liveWith(herd([everyone])))

      yield* Effect.promise(() => screen.findByText('Write the banner'))
      const swipeCard = present(
        cardButton('Write the banner').closest('[data-slot="swipe-card"]'),
        'The swipe card',
      )

      const actionOf = (name: string) =>
        within(present(swipeCard.parentElement, 'The swipe row')).getByRole('button', {
          name,
          hidden: true,
        })
      const opened = (name: string) =>
        eventually(() => {
          expect(actionOf(name).parentElement).toHaveProperty('inert', false)
        })

      yield* dragX(swipeCard, [200, 190, 180, 170, 160, 150, 140, 130, 120, 110, 100])
      yield* opened('Pin')
      fireEvent.click(actionOf('Pin'))

      yield* eventually(() => {
        expect(Ref.getUnsafe(link.pins)).toEqual([
          { machine: LAPTOP, pane: banner.pane, pinned: true },
        ])
      })

      yield* dragX(swipeCard, [200, 190, 180, 170, 160, 150, 140, 130, 120, 110, 100])
      yield* opened('Close')
      fireEvent.click(actionOf('Close'))
      const sheet = yield* Effect.promise(() => screen.findByRole('dialog'))

      expect(within(sheet).getByRole('button', { name: 'Hold to close agent' })).toBeDefined()
    }),
  )

  it.effect("shows the hub's refusal of a pin beneath the card", () =>
    Effect.gen(function* () {
      const { link } = yield* renderApp('/', liveWith(herd([everyone])))
      const refusal = new HubStorageFailed({ detail: 'disk full' })

      yield* Ref.set(link.pinRefusal, Option.some(refusal))
      yield* Effect.promise(() => screen.findByText('Write the banner'))
      const swipeCard = present(
        cardButton('Write the banner').closest('[data-slot="swipe-card"]'),
        'The swipe card',
      )
      const swipeRow = present(swipeCard.parentElement, 'The swipe row')
      const pin = within(swipeRow).getByRole('button', { name: 'Pin', hidden: true })

      yield* dragX(swipeCard, [200, 190, 180, 170, 160, 150, 140, 130, 120, 110, 100])
      yield* eventually(() => {
        expect(pin.parentElement).toHaveProperty('inert', false)
      })
      fireEvent.click(pin)
      const alert = yield* Effect.promise(() => screen.findByRole('alert'))

      expect(alert.textContent).toBe(refusal.message)
      expect(alert.closest('li')?.textContent).toContain('Write the banner')
    }),
  )
})
