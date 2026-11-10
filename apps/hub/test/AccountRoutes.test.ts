import { expect, layer } from '@effect/vitest'
import * as Effect from 'effect/Effect'

import { ClientApi, HubAccount } from '@crook/protocol/ClientApi'
import { CLIENT_PATH } from '@crook/protocol/HubRoutes'

import { connect, OWNER, ownerLogin, testHub } from './Fixtures'

layer(testHub, { excludeTestServices: true })('Account through HttpRoutes', (live) => {
  live.effect('answers GetAccount with the email the upgrade logged in with', () =>
    Effect.gen(function* () {
      const phone = yield* connect(ClientApi, CLIENT_PATH, ownerLogin)

      expect(yield* phone.GetAccount()).toEqual(new HubAccount({ email: OWNER }))
    }).pipe(Effect.scoped),
  )
})
