import * as Context from 'effect/Context'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Schema from 'effect/Schema'
import * as FetchHttpClient from 'effect/http/FetchHttpClient'
import * as HttpClient from 'effect/http/HttpClient'
import * as HttpClientResponse from 'effect/http/HttpClientResponse'

import { LINK_OPEN_TIMEOUT } from '@crook/protocol/LinkTiming'
import { HEALTH_PATH } from '@crook/protocol/HubRoutes'
import { EXE_DEV_LOGOUT_PATH } from '@crook/web/connection/ExeDevPaths'

export type LogOutFailed = LogOutRefused | LogOutUnreachable

const OPAQUE_REDIRECT_STATUS = 0
const PROXY_REQUEST_INIT: RequestInit = { redirect: 'manual', cache: 'no-store' }

export const SESSION_CHECK_TIMEOUT = LINK_OPEN_TIMEOUT

export class LogOutRefused extends Schema.TaggedError<LogOutRefused>()('LogOutRefused', {
  status: Schema.Int,
}) {
  override get message(): string {
    return `exe.dev did not end the session, so this device may still be logged in. Try again; if crook is open without the exe.dev proxy in front of it, there is no exe.dev session to end.`
  }
}

export class LogOutUnreachable extends Schema.TaggedError<LogOutUnreachable>()(
  'LogOutUnreachable',
  { detail: Schema.String },
) {
  override get message(): string {
    return `crook could not reach exe.dev to log out (${this.detail}), so this device is still logged in. Check the phone's network and try again.`
  }
}

const makeSessionCheck = Effect.fn('makeSessionCheck')(function* (page: URL) {
  const client = yield* HttpClient.HttpClient

  const expired = client.get(new URL(HEALTH_PATH, page)).pipe(
    Effect.map((response) => response.status === OPAQUE_REDIRECT_STATUS),
    Effect.provideService(FetchHttpClient.RequestInit, PROXY_REQUEST_INIT),
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

  const logOut = client.post(new URL(EXE_DEV_LOGOUT_PATH, page)).pipe(
    Effect.provideService(FetchHttpClient.RequestInit, PROXY_REQUEST_INIT),
    Effect.catchTag('HttpClientError', (error) =>
      Effect.fail(new LogOutUnreachable({ detail: error.message })),
    ),
    Effect.timeoutOrElse({
      duration: SESSION_CHECK_TIMEOUT,
      orElse: () =>
        Effect.fail(
          new LogOutUnreachable({
            detail: `no answer within ${Duration.format(SESSION_CHECK_TIMEOUT)}`,
          }),
        ),
    }),
    Effect.flatMap(
      HttpClientResponse.matchStatus({
        [OPAQUE_REDIRECT_STATUS]: () => Effect.void,
        '2xx': () => Effect.void,
        orElse: (response) => Effect.fail(new LogOutRefused({ status: response.status })),
      }),
    ),
    Effect.withSpan('SessionCheck.logOut'),
  )

  return SessionCheck.of({ expired, logOut })
})

export class SessionCheck extends Context.Service<
  SessionCheck,
  {
    readonly expired: Effect.Effect<boolean>
    readonly logOut: Effect.Effect<void, LogOutFailed>
  }
>()('@crook/web/SessionCheck') {
  static readonly layerOnPage = (page: URL) => Layer.effect(this, makeSessionCheck(page))

  static readonly layer = Layer.unwrap(
    Effect.sync(() => SessionCheck.layerOnPage(new URL(window.location.href))),
  )
}
