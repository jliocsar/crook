import * as Cause from 'effect/Cause'
import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import * as Ref from 'effect/Ref'
import * as SubscriptionRef from 'effect/SubscriptionRef'

import { defaultNotificationPrefs, NotificationSettings } from '@crook/domain/Notifications'
import { HubStorageFailed } from '@crook/protocol/ClientApi'
import { HarkReachedNoDevice } from '@crook/protocol/Hark'
import { HubCallDefected } from '@crook/web/rpc/HubConnection'
import { OFFLINE, UNREACHABLE } from '@crook/web/rpc/HubLinkState'
import type { LinkStatus } from '@crook/web/rpc/HubLinkState'
import { LogOutRefused } from '@crook/web/rpc/SessionCheck'

import { liveWith, stateWith } from '../../test/AppWiring.tsx'
import { herd } from '../../test/HerdFixtures.ts'
import { SETTINGS_PATH } from '../Fixtures.ts'
import { clicks, role, seesText } from '../StageDom.ts'
import { linkStory, step } from '../Story.tsx'
import type { LinkStage, LinkStorySpec, StoryMaker } from '../Story.tsx'

const EMPTY_LIVE = liveWith(herd([]))
const TEST_BUTTON = /^(?:Send a test|Sending|Sent to your phone)$/u
const APPROVALS = 'Approvals'
const LOG_OUT = 'Log out'

const story = (spec: Omit<LinkStorySpec, 'path' | 'link'>) =>
  linkStory({ ...spec, path: SETTINGS_PATH, link: EMPTY_LIVE })

const unavailable = (slug: string, title: string, status: LinkStatus) =>
  linkStory({
    slug,
    title,
    path: SETTINGS_PATH,
    link: stateWith(status, Option.some(herd([]))),
    arrange: ({ link }) => link.settingsReads.close,
    shows: { text: 'Your notification choices show once crook reconnects.' },
  })

const toggle = () =>
  Effect.flatMap(role(APPROVALS, 'switch'), (found) =>
    Effect.sync(() => {
      found.click()
    }),
  )

const openLogOut = Effect.andThen(clicks(LOG_OUT), seesText('Log out of crook?'))

const failSettings = ({ link }: LinkStage) =>
  Ref.set(link.settingsFailure, Option.some(new HubCallDefected({ cause: Cause.die('hub') })))

export const SETTINGS_STORIES: readonly StoryMaker[] = [
  story({ slug: 'shown', title: 'Settings, everything loaded', shows: { text: APPROVALS } }),
  story({
    slug: 'loading',
    title: 'Settings, toggles and account loading',
    arrange: ({ link }) => link.settingsReads.close,
    shows: { selector: '[data-slot="toggles-skeleton"]' },
  }),
  unavailable('unavailable-offline', 'Settings, offline before the toggles arrived', OFFLINE),
  unavailable(
    'unavailable-unreachable',
    'Settings, the hub unreachable before the toggles arrived',
    UNREACHABLE,
  ),
  story({
    slug: 'failed',
    title: 'Settings, toggles and account failed',
    shows: { text: 'A call to the hub died instead of failing' },
    arrange: failSettings,
  }),
  story({
    slug: 'no-token',
    title: 'Settings, no Hark token',
    arrange: ({ link }) =>
      SubscriptionRef.set(
        link.settings,
        new NotificationSettings({ prefs: defaultNotificationPrefs, delivery: 'noToken' }),
      ),
    shows: { text: 'Notifications are off' },
  }),
  story({
    slug: 'toggle-busy',
    title: 'Settings, a toggle write in flight',
    shows: { selector: '[role="switch"][aria-busy="true"]' },
    arrange: ({ link }) => link.prefAnswers.close,
    settle: toggle,
  }),
  story({
    slug: 'toggle-failed',
    title: 'Settings, a toggle write refused',
    arrange: ({ link }) =>
      Ref.set(link.prefRefusal, Option.some(new HubStorageFailed({ detail: 'disk full' }))),
    settle: toggle,
    shows: { text: 'disk full' },
  }),
  story({
    slug: 'test-sending',
    title: 'Settings, test notification Sending',
    arrange: ({ link }) => link.testAnswers.close,
    settle: () => clicks(TEST_BUTTON),
    shows: { text: 'Sending' },
  }),
  story({
    slug: 'test-sent',
    title: 'Settings, test notification Sent',
    settle: () => clicks(TEST_BUTTON),
    shows: { text: 'Sent to your phone' },
  }),
  story({
    slug: 'test-sent-clears',
    title: 'Settings, test notification Sent, back to Send a test once it has had its time',
    shows: { text: 'Send a test' },
    ends: { text: 'Send a test' },
    timeline: [
      step<LinkStage>(400, 'Tap Send a test', () => clicks(TEST_BUTTON)),
      step<LinkStage>(600, 'It went out', () => seesText('Sent to your phone')),
    ],
  }),
  story({
    slug: 'test-failed',
    title: 'Settings, test notification reached no phone',
    arrange: ({ link }) => Ref.set(link.testRefusal, Option.some(new HarkReachedNoDevice())),
    settle: () => clicks(TEST_BUTTON),
    shows: { selector: '[role="alert"]' },
  }),
  story({
    slug: 'log-out-sheet',
    title: 'Settings, log out sheet',
    shows: { text: 'Log out of crook?' },
    settle: () => openLogOut,
  }),
  story({
    slug: 'log-out-pending',
    title: 'Settings, log out waiting',
    shows: { text: 'Logging out' },
    arrange: ({ link }) => link.logOutAnswers.close,
    settle: () => Effect.andThen(openLogOut, clicks(/^Log out/u)),
  }),
  story({
    slug: 'log-out-failed',
    title: 'Settings, log out refused',
    arrange: ({ link }) =>
      Ref.set(link.logOutRefusal, Option.some(new LogOutRefused({ status: 500 }))),
    settle: () => Effect.andThen(openLogOut, clicks(/^Log out/u)),
    shows: { selector: '[role="alert"]' },
  }),
]
