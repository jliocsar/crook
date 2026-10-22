import { describe, expect, it } from '@effect/vitest'
import { screen, within } from '@testing-library/react'
import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import * as Ref from 'effect/Ref'
import * as SubscriptionRef from 'effect/SubscriptionRef'
import { beforeEach } from 'vitest'

import { CrookVersion } from '@crook/domain/CrookVersion'
import { HerdView } from '@crook/domain/HerdView'
import { defaultNotificationPrefs, NotificationSettings } from '@crook/domain/Notifications'
import { HubStorageFailed } from '@crook/protocol/ClientApi'
import { HarkNotConfigured, HarkReachedNoDevice } from '@crook/protocol/Hark'
import { LinkStatus } from '@crook/web/rpc/HubLinkState'
import { LogOutRefused } from '@crook/web/rpc/SessionCheck'

import { liveWith, renderApp, stateWith } from '../AppRender.tsx'
import { click, eventually, findByRole, present } from '../Dom.ts'
import { OWNER_EMAIL } from '../HubFakes.ts'
import { stubMediaQueries } from '../MediaQueries.ts'

const view = new HerdView({ machines: [], hubVersion: CrookVersion.make('0.1.0') })

const sectionOf = (name: string) =>
  within(present(screen.getByRole('heading', { name }).closest('section'), `The ${name} section`))

const valueOf = (section: string, label: string) =>
  sectionOf(section).getByText(label).nextElementSibling?.textContent

const switchOf = (name: string) => screen.getByRole('switch', { name })

const testButton = () =>
  screen.getByRole('button', { name: /^(?:Send a test|Sending|Sent to your phone)$/u })

beforeEach(() => {
  stubMediaQueries(['(prefers-reduced-motion)'])
})

describe('SettingsScreen', () => {
  it.effect('shows the switches, the account and the hub on one page', () =>
    Effect.gen(function* () {
      yield* renderApp('/settings', liveWith(view))

      expect((yield* findByRole('heading', 'Settings')).tagName).toBe('H1')

      yield* eventually(() => {
        expect(switchOf('Approvals').getAttribute('aria-checked')).toBe('true')
      })

      expect(switchOf('Questions').getAttribute('aria-checked')).toBe('true')
      expect(switchOf('Finished').getAttribute('aria-checked')).toBe('true')
      expect(switchOf('Live Activity').getAttribute('aria-checked')).toBe('true')
      expect(
        screen.getByText('Saved on the hub, so every device you log in on shares them.'),
      ).toBeDefined()
      expect(screen.getByText(/never what Claude wrote/u)).toBeDefined()
      expect(valueOf('Account', 'Logged in as')).toBe(OWNER_EMAIL)
      expect(screen.getByText(/End its session on exe.dev from another device/u)).toBeDefined()
      expect(valueOf('Hub', 'Status')).toBe('connected')
      expect(valueOf('Hub', 'Address')).toBe(window.location.host)
      expect(valueOf('Hub', 'Version')).toBe('0.1.0')
      expect(screen.queryByText('Notifications are off')).toBeNull()
    }),
  )

  it.effect('shows skeleton rows until the hub has sent the settings', () =>
    Effect.gen(function* () {
      const { link, router } = yield* renderApp('/', liveWith(view))

      yield* link.settingsReads.close
      yield* Effect.promise(() => router.navigate({ to: '/settings' }))
      yield* findByRole('heading', 'Settings')

      expect(screen.getByText('Loading your notification settings')).toBeDefined()
      expect(screen.getByText('Loading your account')).toBeDefined()
      expect(screen.queryByRole('switch')).toBeNull()
      expect(screen.queryByText('Approvals')).toBeNull()

      yield* link.settingsReads.open
      yield* eventually(() => {
        expect(switchOf('Approvals').getAttribute('aria-checked')).toBe('true')
      })

      expect(screen.queryByText('Loading your notification settings')).toBeNull()
      expect(valueOf('Account', 'Logged in as')).toBe(OWNER_EMAIL)
    }),
  )

  it.effect('shows the last settings at once when the screen is opened again', () =>
    Effect.gen(function* () {
      const { link, router } = yield* renderApp('/settings', liveWith(view))

      yield* eventually(() => {
        expect(switchOf('Finished').getAttribute('aria-checked')).toBe('true')
      })
      yield* Effect.promise(() => router.navigate({ to: '/' }))
      yield* eventually(() => {
        expect(screen.queryByRole('switch', { name: 'Finished' })).toBeNull()
      })
      yield* link.settingsReads.close
      yield* Effect.promise(() => router.navigate({ to: '/settings' }))
      yield* findByRole('heading', 'Settings')

      expect(switchOf('Finished').getAttribute('aria-checked')).toBe('true')
      expect(valueOf('Account', 'Logged in as')).toBe(OWNER_EMAIL)
      expect(screen.queryByText('Loading your notification settings')).toBeNull()
    }),
  )

  it.effect('writes a switch to the hub and shows what the hub then holds', () =>
    Effect.gen(function* () {
      const { link } = yield* renderApp('/settings', liveWith(view))

      yield* eventually(() => {
        expect(switchOf('Finished').getAttribute('aria-checked')).toBe('true')
      })
      yield* click(switchOf('Finished'))
      yield* eventually(() => {
        expect(switchOf('Finished').getAttribute('aria-checked')).toBe('false')
      })

      expect(yield* Ref.get(link.prefWrites)).toEqual([{ event: 'finished', enabled: false }])
    }),
  )

  it.effect('keeps a switch focusable but unchangeable while its write is in flight', () =>
    Effect.gen(function* () {
      const { link } = yield* renderApp('/settings', liveWith(view))

      yield* link.prefAnswers.close
      yield* eventually(() => {
        expect(switchOf('Finished').getAttribute('aria-checked')).toBe('true')
      })
      yield* click(switchOf('Finished'))
      yield* eventually(() => {
        expect(switchOf('Finished').getAttribute('aria-readonly')).toBe('true')
      })

      expect(switchOf('Finished').hasAttribute('data-disabled')).toBe(false)
      expect(switchOf('Finished').getAttribute('aria-busy')).toBe('true')

      yield* click(switchOf('Finished'))
      yield* link.prefAnswers.open
      yield* eventually(() => {
        expect(switchOf('Finished').getAttribute('aria-checked')).toBe('false')
      })

      expect(switchOf('Finished').hasAttribute('aria-readonly')).toBe(false)
      expect(yield* Ref.get(link.prefAttempts)).toEqual([{ event: 'finished', enabled: false }])
      expect(yield* Ref.get(link.prefWrites)).toEqual([{ event: 'finished', enabled: false }])
    }),
  )

  it.effect('keeps the switch where the hub has it and says why a write was refused', () =>
    Effect.gen(function* () {
      const { link } = yield* renderApp('/settings', liveWith(view))
      const refusal = new HubStorageFailed({ detail: 'disk I/O error' })

      yield* Ref.set(link.prefRefusal, Option.some(refusal))
      yield* eventually(() => {
        expect(switchOf('Questions').getAttribute('aria-checked')).toBe('true')
      })
      yield* click(switchOf('Questions'))
      const alert = yield* Effect.promise(() => screen.findByRole('alert'))

      expect(alert.textContent).toBe(refusal.message)
      expect(switchOf('Questions').getAttribute('aria-checked')).toBe('true')
    }),
  )

  it.effect('says notifications are off while the hub has no Hark token', () =>
    Effect.gen(function* () {
      const { link } = yield* renderApp('/settings', liveWith(view))

      yield* SubscriptionRef.set(
        link.settings,
        new NotificationSettings({ prefs: defaultNotificationPrefs, delivery: 'noToken' }),
      )
      const notice = yield* Effect.promise(() => screen.findByRole('note'))

      expect(within(notice).getByText('Notifications are off')).toBeDefined()
      expect(notice.textContent).toContain(new HarkNotConfigured().message)
      expect(testButton().getAttribute('aria-disabled')).toBe('true')
      expect(switchOf('Approvals').hasAttribute('data-disabled')).toBe(false)

      yield* click(testButton())

      expect(yield* Ref.get(link.testSends)).toBe(0)
    }),
  )

  it.effect('sends a test, showing Sending until the hub answers and then Sent', () =>
    Effect.gen(function* () {
      const { link } = yield* renderApp('/settings', liveWith(view))

      yield* link.testAnswers.close
      yield* eventually(() => {
        expect(testButton().getAttribute('aria-disabled')).toBe('false')
      })
      yield* click(testButton())
      yield* eventually(() => {
        expect(testButton().textContent).toBe('Sending')
      })
      yield* link.testAnswers.open
      yield* eventually(() => {
        expect(testButton().textContent).toBe('Sent to your phone')
      })

      expect(yield* Ref.get(link.testSends)).toBe(1)
    }),
  )

  it.effect('says why a test reached no phone', () =>
    Effect.gen(function* () {
      const { link } = yield* renderApp('/settings', liveWith(view))
      const refusal = new HarkReachedNoDevice()

      yield* Ref.set(link.testRefusal, Option.some(refusal))
      yield* eventually(() => {
        expect(testButton().getAttribute('aria-disabled')).toBe('false')
      })
      yield* click(testButton())
      const alert = yield* Effect.promise(() => screen.findByRole('alert'))

      expect(alert.textContent).toBe(refusal.message)
      expect(testButton().textContent).toBe('Send a test')
    }),
  )

  it.effect('turns the switches and the test off while the hub is unreachable', () =>
    Effect.gen(function* () {
      const { link } = yield* renderApp('/settings', liveWith(view))

      yield* eventually(() => {
        expect(switchOf('Approvals').hasAttribute('data-disabled')).toBe(false)
      })
      yield* SubscriptionRef.set(link.state, stateWith(LinkStatus.Unreachable(), Option.some(view)))
      yield* eventually(() => {
        expect(valueOf('Hub', 'Status')).toBe('unreachable')
      })

      expect(switchOf('Approvals').hasAttribute('data-disabled')).toBe(true)
      expect(testButton().getAttribute('aria-disabled')).toBe('true')
    }),
  )

  it.effect('logs out after the confirm sheet and lands on the logged-out screen', () =>
    Effect.gen(function* () {
      const { link } = yield* renderApp('/settings', liveWith(view))

      yield* click(yield* findByRole('button', 'Log out'))
      const sheet = yield* findByRole('dialog', 'Log out of crook?')

      expect(within(sheet).getByText('Your agents keep running.')).toBeDefined()
      expect(within(sheet).getByText(/on this phone only/u)).toBeDefined()

      yield* click(within(sheet).getByRole('button', { name: 'Log out' }))
      const heading = yield* findByRole('heading', "You're logged out")

      expect(heading.tagName).toBe('H1')
      expect(screen.getByRole('button', { name: 'Log in with exe.dev' })).toBeDefined()
      expect(screen.queryByRole('dialog')).toBeNull()
      expect(yield* Ref.get(link.logOuts)).toBe(1)
    }),
  )

  it.effect('keeps the sheet open with the reason when exe.dev refuses the logout', () =>
    Effect.gen(function* () {
      const { link } = yield* renderApp('/settings', liveWith(view))
      const refusal = new LogOutRefused({ status: 404 })

      yield* Ref.set(link.logOutRefusal, Option.some(refusal))
      yield* click(yield* findByRole('button', 'Log out'))
      const sheet = yield* findByRole('dialog', 'Log out of crook?')

      yield* click(within(sheet).getByRole('button', { name: 'Log out' }))
      const alert = yield* Effect.promise(() => within(sheet).findByRole('alert'))

      expect(alert.textContent).toBe(refusal.message)
      expect(within(sheet).getByRole('button', { name: 'Log out' })).toBeDefined()
      expect(screen.queryByRole('heading', { name: "You're logged out" })).toBeNull()
    }),
  )

  it.effect('opens the confirm sheet clean again after a refused logout', () =>
    Effect.gen(function* () {
      const { link } = yield* renderApp('/settings', liveWith(view))

      yield* Ref.set(link.logOutRefusal, Option.some(new LogOutRefused({ status: 404 })))
      yield* click(yield* findByRole('button', 'Log out'))
      const refusedSheet = yield* findByRole('dialog', 'Log out of crook?')

      yield* click(within(refusedSheet).getByRole('button', { name: 'Log out' }))
      yield* Effect.promise(() => within(refusedSheet).findByRole('alert'))
      yield* click(within(refusedSheet).getByRole('button', { name: 'Cancel' }))
      yield* eventually(() => {
        expect(screen.queryByRole('dialog')).toBeNull()
      })
      yield* click(yield* findByRole('button', 'Log out'))
      const reopened = yield* findByRole('dialog', 'Log out of crook?')

      expect(within(reopened).queryByRole('alert')).toBeNull()
      expect(yield* Ref.get(link.logOuts)).toBe(0)
    }),
  )

  it.effect('closes the confirm sheet on Cancel without logging out', () =>
    Effect.gen(function* () {
      const { link } = yield* renderApp('/settings', liveWith(view))

      yield* click(yield* findByRole('button', 'Log out'))
      const sheet = yield* findByRole('dialog', 'Log out of crook?')

      yield* click(within(sheet).getByRole('button', { name: 'Cancel' }))
      yield* eventually(() => {
        expect(screen.queryByRole('dialog')).toBeNull()
      })

      expect(yield* Ref.get(link.logOuts)).toBe(0)
    }),
  )
})
