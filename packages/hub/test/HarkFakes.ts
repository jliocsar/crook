import * as ConfigProvider from 'effect/ConfigProvider'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Queue from 'effect/Queue'
import * as Schema from 'effect/Schema'
import * as Headers from 'effect/http/Headers'
import * as HttpBody from 'effect/http/HttpBody'
import * as HttpClient from 'effect/http/HttpClient'
import { HttpClientError, TransportError } from 'effect/http/HttpClientError'
import type * as HttpClientRequest from 'effect/http/HttpClientRequest'
import * as HttpClientResponse from 'effect/http/HttpClientResponse'
import * as UrlParams from 'effect/http/UrlParams'
import * as TestClock from 'effect/testing/TestClock'

import { HARK_REQUEST_SPACING } from '@crook/hub/HarkClient'

export interface HarkCall {
  readonly method: string
  readonly url: string
  readonly query: string
  readonly authorization: Option.Option<string>
  readonly idempotencyKey: Option.Option<string>
  readonly body: Option.Option<Schema.Json>
}

export interface HarkAnswer {
  readonly status: number
  readonly body: Schema.Json
  readonly headers?: Record<string, string>
}

export type HarkScript = (call: HarkCall) => HarkAnswer | 'unreachable' | 'silent' | 'broken'

const NOT_IN_HARK_ID = /[^A-Za-z0-9_-]/gu

export const HARK_TOKEN = 'hark_test_token'

const TitledBody = Schema.Struct({ title: Schema.String })

const decodeJson = Schema.decodeSync(Schema.fromJsonString(Schema.Json))

const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Json))

const bodyOf = (request: HttpClientRequest.HttpClientRequest) =>
  request.body instanceof HttpBody.Uint8Array
    ? Option.some(decodeJson(new TextDecoder().decode(request.body.body)))
    : Option.none()

const callOf = (request: HttpClientRequest.HttpClientRequest): HarkCall => ({
  method: request.method,
  url: request.url,
  query: UrlParams.toString(request.urlParams),
  authorization: Headers.get(request.headers, 'authorization'),
  idempotencyKey: Headers.get(request.headers, 'idempotency-key'),
  body: bodyOf(request),
})

const responseTo = (
  request: HttpClientRequest.HttpClientRequest,
  answer: ReturnType<HarkScript>,
) => {
  if (answer === 'silent') {
    return Effect.never
  }

  if (answer === 'broken') {
    return Effect.die(new Error('the fake Hark client broke'))
  }

  if (answer === 'unreachable') {
    return Effect.fail(
      new HttpClientError({
        reason: new TransportError({ request, description: 'connection refused' }),
      }),
    )
  }

  return Effect.succeed(
    HttpClientResponse.fromWeb(
      request,
      new Response(encodeJson(answer.body), {
        status: answer.status,
        headers: { 'content-type': 'application/json', ...answer.headers },
      }),
    ),
  )
}

export const created = (id: string, accepted = 1): HarkAnswer => ({
  status: 201,
  body: { notification: { id }, accepted },
})

export const withdrawn = (id: string): HarkAnswer => ({
  status: 200,
  body: { ok: true, notificationId: id, status: 'withdrawn', accepted: 1 },
})

export const isWithdrawal = (call: HarkCall) => call.url.endsWith('/withdraw')

export const isAskCreation = (call: HarkCall) => call.url.endsWith('/interactions')

export const isWait = (call: HarkCall) => call.url.endsWith('/wait')

export const isCancel = (call: HarkCall) => call.url.endsWith('/cancel')

export const isActivityCall = (call: HarkCall) => call.url.includes('/activities')

export const interactionCreated = (id: string): HarkAnswer => ({
  status: 201,
  body: { interaction: { id, status: 'pending' }, accepted: 1 },
})

export const interactionWaited = (status: string): HarkAnswer => ({
  status: 200,
  body: { interaction: { status }, timedOut: status === 'pending' },
})

export const activityChanged: HarkAnswer = {
  status: 200,
  body: { activity: { id: 'act_1', key: 'crook-herd' }, accepted: 1, failed: 0 },
}

const titleOf = (call: HarkCall) =>
  call.body.pipe(
    Option.flatMap(Schema.decodeUnknownOption(TitledBody)),
    Option.map((body) => body.title),
    Option.getOrElse(() => ''),
  )

export const harkIdFor = (title: string) => `anot_${title.replaceAll(NOT_IN_HARK_ID, '_')}`

export const acceptingHark: HarkScript = (call) =>
  isWithdrawal(call) ? withdrawn('anot_withdrawn') : created(harkIdFor(titleOf(call)))

export const tokenConfig = (token: Option.Option<string>) =>
  ConfigProvider.layer(
    ConfigProvider.fromUnknown(
      Option.match(token, {
        onNone: () => ({}),
        onSome: (value) => ({ CROOK_HUB_HARK_TOKEN: value }),
      }),
    ),
  )

export const fakeHark = Effect.fn('fakeHark')(function* (script: HarkScript) {
  const calls = yield* Queue.unbounded<HarkCall>()
  const client = HttpClient.make((request) => {
    const call = callOf(request)
    const answer = script(call)

    return Queue.offer(calls, call).pipe(Effect.andThen(responseTo(request, answer)))
  })

  return { calls, layer: Layer.succeed(HttpClient.HttpClient, client) }
})

export const advancingClock = <Success, Failure, Requirements>(
  effect: Effect.Effect<Success, Failure, Requirements>,
) =>
  Effect.raceFirst(
    effect,
    TestClock.adjust(HARK_REQUEST_SPACING).pipe(Effect.andThen(Effect.yieldNow), Effect.forever),
  )

export const nextCallWhere = (
  calls: Queue.Dequeue<HarkCall>,
  isWanted: (call: HarkCall) => boolean,
) => advancingClock(Queue.take(calls).pipe(Effect.repeat({ until: isWanted })))

export const callsWithin = Effect.fn('callsWithin')(function* (
  calls: Queue.Dequeue<HarkCall>,
  steps: number,
) {
  yield* TestClock.adjust(HARK_REQUEST_SPACING).pipe(
    Effect.andThen(Effect.yieldNow),
    Effect.repeat({ times: steps }),
  )

  return yield* Queue.clear(calls)
})
