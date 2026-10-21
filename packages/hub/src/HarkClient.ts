import * as Arr from 'effect/Array'
import * as Clock from 'effect/Clock'
import * as Config from 'effect/Config'
import * as Context from 'effect/Context'
import * as Data from 'effect/Data'
import * as DateTime from 'effect/DateTime'
import * as Deferred from 'effect/Deferred'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import { pipe } from 'effect/Function'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'
import * as Num from 'effect/Number'
import * as Option from 'effect/Option'
import type * as Redacted from 'effect/Redacted'
import * as Ref from 'effect/Ref'
import * as Schema from 'effect/Schema'
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
  HarkServerFailed,
  HarkStillProcessing,
  HarkUnreachable,
  STATUS_NO_DEVICE_ACCEPTED,
} from '@crook/protocol/Hark'

export type HarkApprovalState = 'pending' | 'approved' | 'denied' | 'closed'

export type AfterHarkFailure = 'retry' | 'gaveUp'

interface Turns {
  readonly busy: boolean
  readonly waiting: readonly Deferred.Deferred<void>[]
}

const STATUS_STILL_PROCESSING = 202
const STATUS_NOT_FOUND = 404
const STATUS_CONFLICT = 409
const STATUS_TOO_MANY_REQUESTS = 429
const HARK_API_URL = 'https://hark.ryan.ceo/api/agent'
const HARK_PROJECT = 'crook'
const HARK_REQUESTS_PER_WINDOW = 60
const HARK_ACTIVITY_KEY = 'crook-herd'
const HARK_ACTIVITY_TITLE = 'crook'
const HARK_ACTIVITY_ACCENT = '#EEEBE4'

export const HARK_TITLE_LIMIT = 80
export const HARK_PROMPT_LIMIT = 2000
export const HARK_ACTIVITY_STATUS_LIMIT = 60
export const HARK_ACTIVITY_DETAIL_LIMIT = 240
export const HARK_IDEMPOTENCY_KEY_LIMIT = 200
export const HARK_RATE_WINDOW = Duration.minutes(1)
export const HARK_REQUEST_TIMEOUT = Duration.seconds(10)
export const HARK_WAIT_LIMIT = Duration.seconds(25)
export const HARK_APPROVAL_EXPIRY = Duration.days(1)
export const HARK_ACTIVITY_LIFETIME = Duration.hours(8)

export const HARK_REQUEST_SPACING = Duration.divideUnsafe(
  HARK_RATE_WINDOW,
  HARK_REQUESTS_PER_WINDOW,
)

export const HARK_WAIT_REQUEST_TIMEOUT = Duration.sum(HARK_WAIT_LIMIT, HARK_REQUEST_TIMEOUT)
export const HARK_OUTAGE_PAUSE = Duration.seconds(60)
export const PAUSE_AFTER_HUB_BUG = HARK_REQUEST_SPACING

export const HarkId = Schema.NonEmptyString.pipe(Schema.brand('HarkId'))
export type HarkId = typeof HarkId.Type

export const HarkActivitySymbol = Schema.Literals(['warning', 'terminal', 'success'])
export type HarkActivitySymbol = typeof HarkActivitySymbol.Type

export class HarkNotification extends Data.Class<{
  readonly title: string
  readonly body: string
  readonly idempotencyKey: Option.Option<string>
}> {}

export class HarkApproval extends Data.Class<{
  readonly title: string
  readonly prompt: string
  readonly idempotencyKey: Option.Option<string>
}> {}

export class HarkSent extends Data.Class<{
  readonly id: HarkId
  readonly accepted: number
}> {}

export class HarkActivityContent extends Schema.Class<HarkActivityContent>('HarkActivityContent')({
  status: Schema.String,
  detail: Schema.OptionFromNullOr(Schema.String),
  symbol: HarkActivitySymbol,
}) {}

export class HarkActivityGone extends Schema.TaggedError<HarkActivityGone>()('HarkActivityGone', {
  status: Schema.Int,
}) {
  override get message(): string {
    return `Hark answered ${this.status} to an update of the herd's Live Activity: it has ended or expired, so the hub starts a new one.`
  }
}

const pauseFor = (failure: HarkFailure): Option.Option<Duration.Duration> =>
  Match.value(failure).pipe(
    Match.tagsExhaustive({
      HarkUnreachable: () => Option.some(HARK_OUTAGE_PAUSE),
      HarkServerFailed: () => Option.some(HARK_OUTAGE_PAUSE),
      HarkStillProcessing: () => Option.some(Duration.zero),
      HarkRateLimited: (limited) =>
        Option.map(limited.retryAfterSeconds, (seconds) => Duration.seconds(seconds)),
      HarkRefused: () => Option.none(),
      HarkAnswerUnreadable: () => Option.none(),
      HarkNotConfigured: () => Option.none(),
    }),
  )

export const pauseOrGiveUp = (
  what: string,
  failure: HarkFailure,
): Effect.Effect<AfterHarkFailure> =>
  Option.match(pauseFor(failure), {
    onNone: () =>
      Effect.logError(`The hub gave up on ${what}: ${failure.message}`).pipe(
        Effect.as<AfterHarkFailure>('gaveUp'),
      ),
    onSome: (pause) =>
      Effect.logWarning(
        `The hub retries ${what} in ${Duration.format(pause)}: ${failure.message}`,
      ).pipe(Effect.andThen(Effect.sleep(pause)), Effect.as<AfterHarkFailure>('retry')),
  })

export const gaveUpOnBug = (what: string) =>
  `The hub gave up on ${what} because of a bug in the hub.`

export const pausedOnBug = (what: string) =>
  `The hub's ${what} hit a bug and pauses ${Duration.format(PAUSE_AFTER_HUB_BUG)} before its next step.`

const CrookHubHarkToken = Config.option(Config.Redacted('CROOK_HUB_HARK_TOKEN'))

const InteractionStatus = Schema.Literals([
  'pending',
  'approved',
  'denied',
  'yes',
  'no',
  'replied',
  'canceled',
  'expired',
])

const NotificationCreated = Schema.Struct({
  notification: Schema.Struct({ id: HarkId }),
  accepted: Schema.Int,
})

const NotificationNamed = Schema.Struct({ notification: Schema.Struct({ id: Schema.String }) })

const InteractionCreated = Schema.Struct({ interaction: Schema.Struct({ id: HarkId }) })

const InteractionWaited = Schema.Struct({
  interaction: Schema.Struct({ status: InteractionStatus }),
})

const HarkErrorBody = Schema.Struct({ error: Schema.String })

const APPROVAL_STATES = {
  pending: 'pending',
  approved: 'approved',
  denied: 'denied',
  yes: 'closed',
  no: 'closed',
  replied: 'closed',
  canceled: 'closed',
  expired: 'closed',
} satisfies Record<typeof InteractionStatus.Type, HarkApprovalState>

const secondsOfRetryAfter = (value: string, now: DateTime.Utc) =>
  pipe(
    Num.parse(value),
    Option.filter(Number.isFinite),
    Option.orElse(() =>
      Option.map(DateTime.make(value), (date) => Duration.toSeconds(DateTime.distance(now, date))),
    ),
    Option.map((seconds) =>
      Num.clamp(Math.ceil(seconds), {
        minimum: 0,
        maximum: Duration.toSeconds(HARK_RATE_WINDOW),
      }),
    ),
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

const activityGone = (response: HttpClientResponse.HttpClientResponse) =>
  Effect.fail(new HarkActivityGone({ status: response.status }))

const stillProcessing = () => Effect.fail(new HarkStillProcessing())

const failureCases = {
  [STATUS_TOO_MANY_REQUESTS]: rateLimited,
  '5xx': serverFailed,
  orElse: refused,
}

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

const readInteraction = (response: HttpClientResponse.HttpClientResponse) =>
  HttpClientResponse.schemaBodyJson(InteractionCreated)(response).pipe(
    Effect.map((created) => created.interaction.id),
    Effect.mapError(unreadable),
  )

const readApprovalState = (response: HttpClientResponse.HttpClientResponse) =>
  HttpClientResponse.schemaBodyJson(InteractionWaited)(response).pipe(
    Effect.map((waited): HarkApprovalState => APPROVAL_STATES[waited.interaction.status]),
    Effect.mapError(unreadable),
  )

const withIdempotencyKey =
  (key: Option.Option<string>) => (request: HttpClientRequest.HttpClientRequest) =>
    Option.match(key, {
      onNone: () => request,
      onSome: (value) => HttpClientRequest.setHeader(request, 'Idempotency-Key', value),
    })

const notificationBody = (notification: HarkNotification) => ({
  title: notification.title,
  body: notification.body,
  project: HARK_PROJECT,
})

const approvalBody = (approval: HarkApproval) => ({
  title: approval.title,
  prompt: approval.prompt,
  kind: 'approval',
  presentation: 'notification',
  expiresInSeconds: Duration.toSeconds(HARK_APPROVAL_EXPIRY),
})

const activityStartBody = (content: HarkActivityContent) => ({
  key: HARK_ACTIVITY_KEY,
  replace: true,
  title: HARK_ACTIVITY_TITLE,
  status: content.status,
  ...Option.match(content.detail, { onNone: () => ({}), onSome: (detail) => ({ detail }) }),
  symbol: content.symbol,
  accentColor: HARK_ACTIVITY_ACCENT,
  expiresInSeconds: Duration.toSeconds(HARK_ACTIVITY_LIFETIME),
  staleAfterSeconds: Duration.toSeconds(HARK_ACTIVITY_LIFETIME),
})

const activityUpdateBody = (content: HarkActivityContent) => ({
  status: content.status,
  detail: Option.getOrNull(content.detail),
  symbol: content.symbol,
})

const activityEndBody = (content: HarkActivityContent, linger: Duration.Duration) => ({
  ...activityUpdateBody(content),
  accentColor: HARK_ACTIVITY_ACCENT,
  dismissAfterSeconds: Duration.toSeconds(linger),
})

const interactionUrl = (id: HarkId, action: string) =>
  `${HARK_API_URL}/interactions/${encodeURIComponent(id)}/${action}`

const activityUrl = `${HARK_API_URL}/activities/${encodeURIComponent(HARK_ACTIVITY_KEY)}`

const unreachableAfter = (timeout: Duration.Duration) => () =>
  Effect.fail(
    new HarkUnreachable({ detail: `Hark did not answer within ${Duration.format(timeout)}` }),
  )

export const makeTurns = Effect.gen(function* () {
  const turns = yield* Ref.make<Turns>({ busy: false, waiting: [] })

  const release = Ref.modify(turns, (state): [Option.Option<Deferred.Deferred<void>>, Turns] =>
    Option.match(Arr.head(state.waiting), {
      onNone: () => [Option.none(), { busy: false, waiting: [] }],
      onSome: (next) => [Option.some(next), { busy: true, waiting: Arr.drop(state.waiting, 1) }],
    }),
  ).pipe(
    Effect.flatMap(
      Option.match({
        onNone: () => Effect.void,
        onSome: (next) => Deferred.succeed(next, undefined),
      }),
    ),
  )

  const leaveLine = (mine: Deferred.Deferred<void>) =>
    Ref.modify(turns, (state): [boolean, Turns] =>
      Arr.some(state.waiting, (waiting) => waiting === mine)
        ? [
            false,
            { busy: state.busy, waiting: Arr.filter(state.waiting, (waiting) => waiting !== mine) },
          ]
        : [true, state],
    ).pipe(Effect.flatMap((wasHandedTheTurn) => (wasHandedTheTurn ? release : Effect.void)))

  const join = (mine: Deferred.Deferred<void>) =>
    Ref.modify(turns, (state): [boolean, Turns] =>
      state.busy
        ? [true, { busy: true, waiting: Arr.append(state.waiting, mine) }]
        : [false, { busy: true, waiting: state.waiting }],
    )

  return <Answer, Failure>(request: Effect.Effect<Answer, Failure>) =>
    Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        const mine = yield* Deferred.make<void>()

        if (yield* join(mine)) {
          yield* restore(Deferred.await(mine)).pipe(Effect.onInterrupt(() => leaveLine(mine)))
        }

        return yield* restore(request).pipe(Effect.ensuring(release))
      }),
    )
})

const connected = Effect.fn('HarkClient.connected')(function* (token: Redacted.Redacted) {
  const client = (yield* HttpClient.HttpClient).pipe(
    HttpClient.mapRequest(HttpClientRequest.bearerToken(token)),
  )
  const inTurn = yield* makeTurns
  const lastFinishedAt = yield* Ref.make(Option.none<number>())

  const waitForSpacing = Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis
    const earliest = Option.map(
      yield* Ref.get(lastFinishedAt),
      (finishedAt) => finishedAt + Duration.toMillis(HARK_REQUEST_SPACING),
    )

    yield* Effect.sleep(Duration.millis(Math.max(0, Option.getOrElse(earliest, () => now) - now)))
  })

  const markFinished = Effect.flatMap(Clock.currentTimeMillis, (now) =>
    Ref.set(lastFinishedAt, Option.some(now)),
  )

  const answered = <Answer, Failure>(
    request: HttpClientRequest.HttpClientRequest,
    answer: (response: HttpClientResponse.HttpClientResponse) => Effect.Effect<Answer, Failure>,
    timeout: Duration.Duration,
  ) =>
    client.execute(request).pipe(
      Effect.catchReasons(
        'HttpClientError',
        {
          TransportError: (reason) => Effect.fail(new HarkUnreachable({ detail: reason.message })),
        },
        (reason) => Effect.die(reason),
      ),
      Effect.flatMap(answer),
      Effect.timeoutOrElse({ duration: timeout, orElse: unreachableAfter(timeout) }),
    )

  const execute = <Answer, Failure>(
    request: HttpClientRequest.HttpClientRequest,
    answer: (response: HttpClientResponse.HttpClientResponse) => Effect.Effect<Answer, Failure>,
  ) =>
    inTurn(
      waitForSpacing.pipe(
        Effect.andThen(answered(request, answer, HARK_REQUEST_TIMEOUT)),
        Effect.ensuring(markFinished),
      ),
    )

  const executeLongPoll = <Answer, Failure>(
    request: HttpClientRequest.HttpClientRequest,
    answer: (response: HttpClientResponse.HttpClientResponse) => Effect.Effect<Answer, Failure>,
  ) =>
    inTurn(Effect.andThen(waitForSpacing, markFinished)).pipe(
      Effect.andThen(answered(request, answer, HARK_WAIT_REQUEST_TIMEOUT)),
    )

  const send = Effect.fn('HarkClient.send')(function* (notification: HarkNotification) {
    const request = HttpClientRequest.post(`${HARK_API_URL}/notifications`).pipe(
      HttpClientRequest.bodyJsonUnsafe(notificationBody(notification)),
      withIdempotencyKey(notification.idempotencyKey),
    )

    return yield* execute(
      request,
      HttpClientResponse.matchStatus({
        [STATUS_STILL_PROCESSING]: stillProcessing,
        '2xx': readCreated,
        ...failureCases,
      }),
    )
  })

  const withdraw = Effect.fn('HarkClient.withdraw')(function* (id: HarkId) {
    yield* execute(
      HttpClientRequest.post(`${HARK_API_URL}/notifications/${encodeURIComponent(id)}/withdraw`),
      HttpClientResponse.matchStatus({
        '2xx': () => Effect.void,
        [STATUS_TOO_MANY_REQUESTS]: rateLimited,
        [STATUS_NO_DEVICE_ACCEPTED]: refused,
        '5xx': serverFailed,
        orElse: refused,
      }),
    )
  })

  const ask = Effect.fn('HarkClient.ask')(function* (approval: HarkApproval) {
    const request = HttpClientRequest.post(`${HARK_API_URL}/interactions`).pipe(
      HttpClientRequest.bodyJsonUnsafe(approvalBody(approval)),
      withIdempotencyKey(approval.idempotencyKey),
    )

    return yield* execute(
      request,
      HttpClientResponse.matchStatus({
        [STATUS_STILL_PROCESSING]: stillProcessing,
        '2xx': readInteraction,
        ...failureCases,
      }),
    )
  })

  const awaitApproval = Effect.fn('HarkClient.awaitApproval')(function* (id: HarkId) {
    const request = HttpClientRequest.get(interactionUrl(id, 'wait')).pipe(
      HttpClientRequest.setUrlParam('timeout', String(Duration.toSeconds(HARK_WAIT_LIMIT))),
    )

    return yield* executeLongPoll(
      request,
      HttpClientResponse.matchStatus({
        '2xx': readApprovalState,
        ...failureCases,
      }),
    )
  })

  const cancel = Effect.fn('HarkClient.cancel')(function* (id: HarkId) {
    yield* execute(
      HttpClientRequest.post(interactionUrl(id, 'cancel')),
      HttpClientResponse.matchStatus({
        '2xx': () => Effect.void,
        [STATUS_NOT_FOUND]: () => Effect.void,
        ...failureCases,
      }),
    )
  })

  const startActivity = Effect.fn('HarkClient.startActivity')(function* (
    content: HarkActivityContent,
    idempotencyKey: string,
  ) {
    yield* execute(
      HttpClientRequest.post(`${HARK_API_URL}/activities`).pipe(
        HttpClientRequest.bodyJsonUnsafe(activityStartBody(content)),
        withIdempotencyKey(Option.some(idempotencyKey)),
      ),
      HttpClientResponse.matchStatus({
        '2xx': () => Effect.void,
        ...failureCases,
      }),
    )
  })

  const updateActivity = Effect.fn('HarkClient.updateActivity')(function* (
    content: HarkActivityContent,
  ) {
    yield* execute(
      HttpClientRequest.patch(activityUrl).pipe(
        HttpClientRequest.bodyJsonUnsafe(activityUpdateBody(content)),
      ),
      HttpClientResponse.matchStatus({
        '2xx': () => Effect.void,
        [STATUS_NOT_FOUND]: activityGone,
        [STATUS_CONFLICT]: activityGone,
        ...failureCases,
      }),
    )
  })

  const endActivity = Effect.fn('HarkClient.endActivity')(function* (
    content: HarkActivityContent,
    linger: Duration.Duration,
  ) {
    yield* execute(
      HttpClientRequest.post(`${activityUrl}/end`).pipe(
        HttpClientRequest.bodyJsonUnsafe(activityEndBody(content, linger)),
      ),
      HttpClientResponse.matchStatus({
        '2xx': () => Effect.void,
        [STATUS_NOT_FOUND]: () => Effect.void,
        [STATUS_CONFLICT]: () => Effect.void,
        ...failureCases,
      }),
    )
  })

  return HarkClient.of({
    delivery: 'ready',
    send,
    withdraw,
    ask,
    awaitApproval,
    cancel,
    startActivity,
    updateActivity,
    endActivity,
  })
})

const notConfigured = Effect.gen(function* () {
  const failure = new HarkNotConfigured()

  yield* Effect.logWarning(failure.message)

  const fail = () => Effect.fail(failure)

  return HarkClient.of({
    delivery: 'noToken',
    send: fail,
    withdraw: fail,
    ask: fail,
    awaitApproval: fail,
    cancel: fail,
    startActivity: fail,
    updateActivity: fail,
    endActivity: fail,
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
    readonly withdraw: (id: HarkId) => Effect.Effect<void, HarkFailure>
    readonly ask: (approval: HarkApproval) => Effect.Effect<HarkId, HarkFailure>
    readonly awaitApproval: (id: HarkId) => Effect.Effect<HarkApprovalState, HarkFailure>
    readonly cancel: (id: HarkId) => Effect.Effect<void, HarkFailure>
    readonly startActivity: (
      content: HarkActivityContent,
      idempotencyKey: string,
    ) => Effect.Effect<void, HarkFailure>
    readonly updateActivity: (
      content: HarkActivityContent,
    ) => Effect.Effect<void, HarkFailure | HarkActivityGone>
    readonly endActivity: (
      content: HarkActivityContent,
      linger: Duration.Duration,
    ) => Effect.Effect<void, HarkFailure>
  }
>()('@crook/hub/HarkClient') {
  static readonly layerWithoutDependencies = Layer.effect(this, make)

  static readonly layer = this.layerWithoutDependencies.pipe(Layer.provide(FetchHttpClient.layer))
}
