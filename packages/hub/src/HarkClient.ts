import * as Clock from 'effect/Clock'
import * as Config from 'effect/Config'
import * as Context from 'effect/Context'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import { pipe } from 'effect/Function'
import * as Layer from 'effect/Layer'
import * as Num from 'effect/Number'
import * as Option from 'effect/Option'
import type * as Redacted from 'effect/Redacted'
import * as Ref from 'effect/Ref'
import * as Schema from 'effect/Schema'
import * as Semaphore from 'effect/Semaphore'
import * as FetchHttpClient from 'effect/http/FetchHttpClient'
import * as Headers from 'effect/http/Headers'
import * as HttpClient from 'effect/http/HttpClient'
import * as HttpClientRequest from 'effect/http/HttpClientRequest'
import * as HttpClientResponse from 'effect/http/HttpClientResponse'

import type { HarkDelivery } from '@crook/domain/Notifications'
import {
  HarkAnswerUnreadable,
  type HarkFailure,
  HarkNotConfigured,
  HarkRateLimited,
  HarkRefused,
  HarkUnreachable,
} from '@crook/protocol/Hark'

const STATUS_TOO_MANY_REQUESTS = 429

export const HARK_API_URL = 'https://hark.ryan.ceo/api/agent'
export const HARK_PROJECT = 'crook'
export const HARK_REQUESTS_PER_WINDOW = 60
export const HARK_TITLE_LIMIT = 80
export const HARK_IDEMPOTENCY_KEY_LIMIT = 200
export const HARK_RATE_WINDOW = Duration.minutes(1)

export const HARK_REQUEST_SPACING = Duration.divideUnsafe(
  HARK_RATE_WINDOW,
  HARK_REQUESTS_PER_WINDOW,
)

export const CrookHubHarkToken = Config.option(Config.Redacted('CROOK_HUB_HARK_TOKEN'))

export const HarkNotificationId = Schema.NonEmptyString.pipe(Schema.brand('HarkNotificationId'))
export type HarkNotificationId = typeof HarkNotificationId.Type

export class HarkNotification extends Schema.Class<HarkNotification>('HarkNotification')({
  title: Schema.String,
  body: Schema.String,
  idempotencyKey: Schema.OptionFromNullOr(Schema.String),
}) {}

export class HarkSent extends Schema.Class<HarkSent>('HarkSent')({
  id: HarkNotificationId,
  accepted: Schema.Int,
}) {}

const NotificationCreated = Schema.Struct({
  notification: Schema.Struct({ id: HarkNotificationId }),
  accepted: Schema.Int,
})

const HarkErrorBody = Schema.Struct({ error: Schema.String })

const NOT_CONFIGURED_WARNING =
  'Hark notifications are off: CROOK_HUB_HARK_TOKEN is not set, so the hub sends none and the settings screen says so. Set it to a Hark agent token with the notifications:send scope, then restart the hub.'

const retryAfterOf = (response: HttpClientResponse.HttpClientResponse) =>
  pipe(Headers.get(response.headers, 'retry-after'), Option.flatMap(Num.parse))

const refusalOf = Effect.fn('HarkClient.refusalOf')(function* (
  response: HttpClientResponse.HttpClientResponse,
) {
  if (response.status === STATUS_TOO_MANY_REQUESTS) {
    return yield* new HarkRateLimited({ retryAfterSeconds: retryAfterOf(response) })
  }

  const explanation = yield* HttpClientResponse.schemaBodyJson(HarkErrorBody)(response).pipe(
    Effect.map((body) => body.error),
    Effect.option,
  )

  return yield* new HarkRefused({ status: response.status, explanation })
})

const succeeded = (response: HttpClientResponse.HttpClientResponse) =>
  response.status >= 200 && response.status < 300 ? Effect.succeed(response) : refusalOf(response)

const unreadable = (error: { readonly message: string }) =>
  new HarkAnswerUnreadable({ detail: error.message })

const notificationBody = (notification: HarkNotification) => ({
  title: notification.title,
  body: notification.body,
  project: HARK_PROJECT,
})

const connected = Effect.fn('HarkClient.connected')(function* (token: Redacted.Redacted) {
  const client = (yield* HttpClient.HttpClient).pipe(
    HttpClient.mapRequest(HttpClientRequest.bearerToken(token)),
  )
  const permit = yield* Semaphore.make(1)
  const lastFinishedAt = yield* Ref.make(Option.none<number>())

  const waitForSpacing = Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis
    const earliest = Option.map(
      yield* Ref.get(lastFinishedAt),
      (finishedAt) => finishedAt + Duration.toMillis(HARK_REQUEST_SPACING),
    )

    yield* Effect.sleep(Duration.millis(Math.max(0, Option.getOrElse(earliest, () => now) - now)))
  })

  const execute = (request: HttpClientRequest.HttpClientRequest) =>
    Semaphore.withPermit(
      permit,
      waitForSpacing.pipe(
        Effect.andThen(client.execute(request)),
        Effect.ensuring(
          Effect.flatMap(Clock.currentTimeMillis, (now) =>
            Ref.set(lastFinishedAt, Option.some(now)),
          ),
        ),
      ),
    ).pipe(
      Effect.catchReasons(
        'HttpClientError',
        {
          TransportError: (reason) => Effect.fail(new HarkUnreachable({ detail: reason.message })),
        },
        (reason) => Effect.die(reason),
      ),
    )

  const send = Effect.fn('HarkClient.send')(function* (notification: HarkNotification) {
    const request = HttpClientRequest.post(`${HARK_API_URL}/notifications`).pipe(
      HttpClientRequest.bodyJsonUnsafe(notificationBody(notification)),
      (built) =>
        Option.match(notification.idempotencyKey, {
          onNone: () => built,
          onSome: (key) => HttpClientRequest.setHeader(built, 'Idempotency-Key', key),
        }),
    )
    const response = yield* Effect.flatMap(execute(request), succeeded)

    const created = yield* HttpClientResponse.schemaBodyJson(NotificationCreated)(response).pipe(
      Effect.mapError(unreadable),
    )

    return new HarkSent({ id: created.notification.id, accepted: created.accepted })
  })

  const withdraw = Effect.fn('HarkClient.withdraw')(function* (id: HarkNotificationId) {
    yield* Effect.flatMap(
      execute(
        HttpClientRequest.post(`${HARK_API_URL}/notifications/${encodeURIComponent(id)}/withdraw`),
      ),
      succeeded,
    )
  })

  return HarkClient.of({ delivery: 'ready', send, withdraw })
})

const notConfigured = Effect.gen(function* () {
  yield* Effect.logWarning(NOT_CONFIGURED_WARNING)

  return HarkClient.of({
    delivery: 'noToken',
    send: () => Effect.fail(new HarkNotConfigured()),
    withdraw: () => Effect.fail(new HarkNotConfigured()),
  })
})

const make = Effect.flatMap(
  CrookHubHarkToken,
  Option.match({ onNone: () => notConfigured, onSome: connected }),
)

export class HarkClient extends Context.Service<
  HarkClient,
  {
    readonly delivery: HarkDelivery
    readonly send: (notification: HarkNotification) => Effect.Effect<HarkSent, HarkFailure>
    readonly withdraw: (id: HarkNotificationId) => Effect.Effect<void, HarkFailure>
  }
>()('@crook/hub/HarkClient') {
  static readonly layerWithoutDependencies = Layer.effect(this, make)

  static readonly layer = this.layerWithoutDependencies.pipe(Layer.provide(FetchHttpClient.layer))
}
