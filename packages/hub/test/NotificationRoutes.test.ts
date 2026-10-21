import { expect, layer } from '@effect/vitest'
import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import * as Stream from 'effect/Stream'

import { NotificationSettings, defaultNotificationPrefs } from '@crook/domain/Notifications'
import { ClientApi } from '@crook/protocol/ClientApi'
import { HarkNotConfigured } from '@crook/protocol/Hark'
import { CLIENT_PATH } from '@crook/protocol/HubRoutes'

import { connect, ownerLogin, testHub } from './Fixtures'

layer(testHub, { excludeTestServices: true })(
  'Notification settings through HttpRoutes',
  (live) => {
    live.effect(
      'streams the switches, stores a change and explains a hub without a Hark token',
      () =>
        Effect.gen(function* () {
          const phone = yield* connect(ClientApi, CLIENT_PATH, ownerLogin)
          const before = yield* phone.WatchNotificationSettings().pipe(Stream.runHead)

          yield* phone.SetNotificationPref({ event: 'liveActivity', enabled: false })
          const after = yield* phone.WatchNotificationSettings().pipe(Stream.runHead)
          const testFailure = yield* phone.SendTestNotification().pipe(Effect.flip)

          expect(before).toEqual(
            Option.some(
              new NotificationSettings({ prefs: defaultNotificationPrefs, delivery: 'noToken' }),
            ),
          )
          expect(after).toEqual(
            Option.some(
              new NotificationSettings({
                prefs: { ...defaultNotificationPrefs, liveActivity: false },
                delivery: 'noToken',
              }),
            ),
          )
          expect(testFailure).toEqual(new HarkNotConfigured())
        }).pipe(Effect.scoped),
    )
  },
)
