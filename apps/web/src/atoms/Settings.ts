import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import * as Stream from 'effect/Stream'
import * as Atom from 'effect/reactivity/Atom'

import type { NotificationEvent } from '@crook/domain/Notifications'
import { progressOf } from '@crook/web/atoms/ActionProgress'
import { herdAtom } from '@crook/web/atoms/Herd'
import { hubRuntime } from '@crook/web/atoms/Hub'
import { boundedProgressAtom } from '@crook/web/atoms/SentBound'
import { TOAST_DURATION } from '@crook/web/atoms/Toast'
import { HubLink } from '@crook/web/rpc/HubLink'

export const notificationSettingsAtom = hubRuntime
  .atom(Stream.unwrap(HubLink.useSync((link) => link.notificationSettings)))
  .pipe(Atom.keepAlive)

export const accountAtom = hubRuntime
  .atom(Stream.unwrap(HubLink.useSync((link) => link.account)))
  .pipe(Atom.keepAlive)

export const hubVersionAtom = Atom.make((get) =>
  Option.map(get(herdAtom), (snapshot) => snapshot.view.hubVersion),
)

export const setNotificationPrefAtom = Atom.family((event: NotificationEvent) =>
  hubRuntime.fn((enabled: boolean) =>
    HubLink.use((link) => link.setNotificationPref(event, enabled)),
  ),
)

export const sendTestNotificationAtom = hubRuntime.fn(() =>
  HubLink.use((link) => link.sendTestNotification),
)

export const testNotificationProgressAtom = boundedProgressAtom({
  result: sendTestNotificationAtom,
  progress: (get) => progressOf(get(sendTestNotificationAtom), () => false),
  bound: Effect.succeed(TOAST_DURATION),
})

export const logOutAtom = hubRuntime.fn(() => HubLink.use((link) => link.logOut))
