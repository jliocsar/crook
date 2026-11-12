import { expect, layer } from '@effect/vitest'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Logger from 'effect/Logger'
import * as References from 'effect/References'

import { ClientApi, HubAccount } from '@crook/protocol/ClientApi'
import { CLIENT_PATH, DIAL_REASON_PARAMETER } from '@crook/protocol/HubRoutes'

import { connect, OWNER, ownerLogin, testHub } from './Fixtures'

const PHONE_CONNECTED = 'A phone connected'

const dialReasonsLogged: unknown[] = []

const remembersDialReasons = Logger.layer([
  Logger.make(({ message, fiber }) => {
    if (String(message) === PHONE_CONNECTED) {
      dialReasonsLogged.push(fiber.getRef(References.CurrentLogAnnotations)['dialReason'])
    }
  }),
])

const dialsAs = (query: string) =>
  Effect.gen(function* () {
    const phone = yield* connect(ClientApi, `${CLIENT_PATH}${query}`, ownerLogin)

    return yield* phone.GetAccount()
  }).pipe(Effect.scoped)

layer(Layer.provide(testHub, remembersDialReasons), { excludeTestServices: true })(
  'A phone saying why it dialed',
  (live) => {
    live.effect('logs the reason a phone gives, and serves one that gives none or a new one', () =>
      Effect.gen(function* () {
        const account = new HubAccount({ email: OWNER })

        expect(yield* dialsAs(`?${DIAL_REASON_PARAMETER}=PingTimedOut`)).toEqual(account)
        expect(yield* dialsAs('')).toEqual(account)
        expect(yield* dialsAs(`?${DIAL_REASON_PARAMETER}=SomethingNewer`)).toEqual(account)
        expect(dialReasonsLogged).toEqual(['PingTimedOut', 'unknown', 'unknown'])
      }),
    )
  },
)
