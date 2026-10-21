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

export interface HarkCall {
  readonly method: string
  readonly url: string
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
