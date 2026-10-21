import * as Clock from 'effect/Clock'
import * as Config from 'effect/Config'
import * as Context from 'effect/Context'
import * as Data from 'effect/Data'
import * as DateTime from 'effect/DateTime'
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
import type { HttpClientError } from 'effect/http/HttpClientError'
import * as HttpClientRequest from 'effect/http/HttpClientRequest'
import * as HttpClientResponse from 'effect/http/HttpClientResponse'

import type { HarkDelivery } from '@crook/domain/Notifications'
import {
  HarkAnswerUnreadable,
  type HarkFailure,
  HarkNotConfigured,
  HarkRateLimited,
  HarkRefused,
  HarkServerFailed,
  HarkStillProcessing,
  HarkUnreachable,
} from '@crook/protocol/Hark'

const STATUS_STILL_PROCESSING = 202
const STATUS_TOO_MANY_REQUESTS = 429
const STATUS_NO_DEVICE_TOOK_WITHDRAWAL = 502
const HARK_API_URL = 'https://hark.ryan.ceo/api/agent'
const HARK_PROJECT = 'crook'
const HARK_REQUESTS_PER_WINDOW = 60
const HARK_RATE_WINDOW = Duration.minutes(1)

export const HARK_TITLE_LIMIT = 80
export const HARK_IDEMPOTENCY_KEY_LIMIT = 200
export const HARK_REQUEST_TIMEOUT = Duration.seconds(10)

export const HARK_REQUEST_SPACING = Duration.divideUnsafe(
  HARK_RATE_WINDOW,
  HARK_REQUESTS_PER_WINDOW,
)

export const HarkNotificationId = Schema.NonEmptyString.pipe(Schema.brand('HarkNotificationId'))
export type HarkNotificationId = typeof HarkNotificationId.Type

export class HarkNotification extends Data.Class<{
  readonly title: string
  readonly body: string
  readonly idempotencyKey: Option.Option<string>
}> {}

export class HarkSent extends Data.Class<{
  readonly id: HarkNotificationId
  readonly accepted: number
}> {}

const CrookHubHarkToken = Config.option(Config.Redacted('CROOK_HUB_HARK_TOKEN'))

const NotificationCreated = Schema.Struct({
  notification: Schema.Struct({ id: HarkNotificationId }),
  accepted: Schema.Int,
})

const NotificationNamed = Schema.Struct({ notification: Schema.Struct({ id: Schema.String }) })

const HarkErrorBody = Schema.Struct({ error: Schema.String })

const NOT_CONFIGURED_WARNING =
  'Hark notifications are off: CROOK_HUB_HARK_TOKEN is not set, so the hub sends none and the settings screen says so. Set it to a Hark agent token with the notifications:send scope, then restart the hub.'

const secondsOfRetryAfter = (value: string, now: DateTime.Utc) =>
  pipe(
    Num.parse(value),
    Option.filter(Number.isFinite),
    Option.orElse(() =>
      Option.map(DateTime.make(value), (date) => Duration.toSeconds(DateTime.distance(now, date))),
    ),
    Option.map((seconds) => Math.max(0, Math.ceil(seconds))),
  )

const retryAfterOf = Effect.fn('HarkClient.retryAfterOf')(function* (
  response: HttpClientResponse.HttpClientResponse,
) {
  const now = yield* DateTime.now

  return Option.flatMap(Headers.get(response.headers, 'retry-after'), (value) =>
    secondsOfRetryAfter(value, now),
  )
})

const explanationOf = (response: HttpClientResponse.HttpClientResponse) =>
  HttpClientResponse.schemaBodyJson(HarkErrorBody)(response).pipe(
    Effect.map((body) => body.error),
    Effect.option,
  )

const refused = (response: HttpClientResponse.HttpClientResponse) =>
  Effect.flatMap(explanationOf(response), (explanation) =>
    Effect.fail(new HarkRefused({ status: response.status, explanation })),
  )

const serverFailed = (response: HttpClientResponse.HttpClientResponse) =>
  Effect.flatMap(explanationOf(response), (explanation) =>
    Effect.fail(new HarkServerFailed({ status: response.status, explanation })),
  )

const rateLimited = (response: HttpClientResponse.HttpClientResponse) =>
  Effect.flatMap(retryAfterOf(response), (retryAfterSeconds) =>
    Effect.fail(new HarkRateLimited({ retryAfterSeconds })),
  )

const stillProcessing = () => Effect.fail(new HarkStillProcessing())

const unreadable = (error: { readonly message: string }) =>
  new HarkAnswerUnreadable({ detail: error.message })

const unreadableCreation = (body: Schema.Json) => (error: { readonly message: string }) =>
  Option.match(Schema.decodeUnknownOption(NotificationNamed)(body), {
    onNone: () => unreadable(error),
    onSome: (named) =>
      new HarkAnswerUnreadable({
        detail: `${error.message}; it did create notification ${named.notification.id}, which the hub will not withdraw`,
      }),
  })

const readCreated = Effect.fn('HarkClient.readCreated')(function* (
  response: HttpClientResponse.HttpClientResponse,
) {
  const body = yield* HttpClientResponse.schemaBodyJson(Schema.Json)(response).pipe(
    Effect.mapError(unreadable),
  )
  const created = yield* Schema.decodeUnknownEffect(NotificationCreated)(body).pipe(
    Effect.mapError(unreadableCreation(body)),
  )

  return new HarkSent({ id: created.notification.id, accepted: created.accepted })
})

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

  const execute = <Answer>(
    request: HttpClientRequest.HttpClientRequest,
    answer: (
      response: HttpClientResponse.HttpClientResponse,
    ) => Effect.Effect<Answer, HarkFailure | HttpClientError>,
  ) =>
    Semaphore.withPermit(
      permit,
      waitForSpacing.pipe(
        Effect.andThen(
          client.execute(request).pipe(
            Effect.flatMap(answer),
            Effect.timeoutOrElse({
              duration: HARK_REQUEST_TIMEOUT,
              orElse: () =>
                Effect.fail(
                  new HarkUnreachable({
                    detail: `Hark did not answer within ${Duration.format(HARK_REQUEST_TIMEOUT)}`,
                  }),
                ),
            }),
          ),
        ),
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

    return yield* execute(
      request,
      HttpClientResponse.matchStatus({
        [STATUS_STILL_PROCESSING]: stillProcessing,
        '2xx': readCreated,
        [STATUS_TOO_MANY_REQUESTS]: rateLimited,
        '5xx': serverFailed,
        orElse: refused,
      }),
    )
  })

  const withdraw = Effect.fn('HarkClient.withdraw')(function* (id: HarkNotificationId) {
    yield* execute(
      HttpClientRequest.post(`${HARK_API_URL}/notifications/${encodeURIComponent(id)}/withdraw`),
      HttpClientResponse.matchStatus({
        '2xx': () => Effect.void,
        [STATUS_TOO_MANY_REQUESTS]: rateLimited,
        [STATUS_NO_DEVICE_TOOK_WITHDRAWAL]: refused,
        '5xx': serverFailed,
        orElse: refused,
      }),
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
