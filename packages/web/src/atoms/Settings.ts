import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import * as Stream from 'effect/Stream'
import * as Atom from 'effect/reactivity/Atom'

import type { NotificationEvent } from '@crook/domain/Notifications'
import { herdAtom } from '@crook/web/atoms/Herd'
import { hubRuntime } from '@crook/web/atoms/Hub'
import { HubLink } from '@crook/web/rpc/HubLink'

export const notificationSettingsAtom = hubRuntime
  .atom(
    Stream.unwrap(
      Effect.gen(function* () {
        const link = yield* HubLink

        return link.notificationSettings
      }),
    ),
  )
  .pipe(Atom.keepAlive)

export const accountAtom = hubRuntime
  .atom(
    Stream.unwrap(
      Effect.gen(function* () {
        const link = yield* HubLink

        return link.account
      }),
    ),
  )
  .pipe(Atom.keepAlive)

export const hubVersionAtom = Atom.make((get) =>
  Option.map(get(herdAtom), (snapshot) => snapshot.view.hubVersion),
)

export const setNotificationPrefAtom = Atom.family((event: NotificationEvent) =>
  hubRuntime.fn((enabled: boolean) =>
    Effect.gen(function* () {
      const link = yield* HubLink

      yield* link.setNotificationPref(event, enabled)
    }),
  ),
)

export const sendTestNotificationAtom = hubRuntime.fn(() =>
  Effect.gen(function* () {
    const link = yield* HubLink

    yield* link.sendTestNotification
  }),
)

export const logOutAtom = hubRuntime.fn(() =>
  Effect.gen(function* () {
    const link = yield* HubLink

    yield* link.logOut
  }),
)
