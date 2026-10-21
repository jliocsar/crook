import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as FetchHttpClient from 'effect/http/FetchHttpClient'
import * as HttpClient from 'effect/http/HttpClient'

import { AGENT_SOCKET_OPEN_TIMEOUT } from '@crook/protocol/AgentLink'
import { HEALTH_PATH } from '@crook/protocol/HubRoutes'

const OPAQUE_REDIRECT_STATUS = 0

export const SESSION_CHECK_TIMEOUT = AGENT_SOCKET_OPEN_TIMEOUT

const checkThroughProxy = Effect.gen(function* () {
  const client = yield* HttpClient.HttpClient
  const health = new URL(HEALTH_PATH, window.location.href)

  const expired = client.get(health).pipe(
    Effect.map((response) => response.status === OPAQUE_REDIRECT_STATUS),
    Effect.provideService(FetchHttpClient.RequestInit, { redirect: 'manual', cache: 'no-store' }),
    Effect.timeoutOrElse({
      duration: SESSION_CHECK_TIMEOUT,
      orElse: () => Effect.succeed(false),
    }),
    Effect.catchTag('HttpClientError', (error) =>
      Effect.as(
        Effect.logWarning(
          `crook could not ask ${HEALTH_PATH} whether the exe.dev login still holds, so it treats the hub as unreachable and keeps retrying: ${error.message}`,
        ),
        false,
      ),
    ),
    Effect.withSpan('SessionCheck.expired'),
  )

  return SessionCheck.of({ expired })
})

export class SessionCheck extends Context.Service<
  SessionCheck,
  { readonly expired: Effect.Effect<boolean> }
>()('@crook/web/SessionCheck') {
  static readonly layer = Layer.effect(this, checkThroughProxy).pipe(
    Layer.provide(FetchHttpClient.layer),
  )
}
