import { describe, expect, it } from '@effect/vitest'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as Fiber from 'effect/Fiber'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Ref from 'effect/Ref'
import * as FetchHttpClient from 'effect/http/FetchHttpClient'
import * as HttpClient from 'effect/http/HttpClient'
import * as HttpClientError from 'effect/http/HttpClientError'
import type * as HttpClientRequest from 'effect/http/HttpClientRequest'
import * as HttpClientResponse from 'effect/http/HttpClientResponse'
import * as TestClock from 'effect/testing/TestClock'

import { HEALTH_PATH } from '@crook/protocol/HubRoutes'
import { EXE_DEV_LOGOUT_PATH } from '@crook/web/connection/ExeDevPaths'
import {
  LogOutRefused,
  LogOutUnreachable,
  SESSION_CHECK_TIMEOUT,
  SessionCheck,
} from '@crook/web/rpc/SessionCheck'

type ProxyAnswer = (
  request: HttpClientRequest.HttpClientRequest,
) => Effect.Effect<HttpClientResponse.HttpClientResponse, HttpClientError.HttpClientError>

interface SentRequest {
  readonly method: string
  readonly path: string
  readonly init: Option.Option<RequestInit>
}

const PAGE = new URL('https://my-hub.exe.xyz/settings')

const proxyRequestInit = { redirect: 'manual', cache: 'no-store' }

const answerWith =
  (status: number): ProxyAnswer =>
  (request) =>
    Effect.succeed(HttpClientResponse.fromWeb(request, new Response(null, { status })))

const answerWithStatusZero: ProxyAnswer = (request) =>
  Effect.succeed(HttpClientResponse.fromWeb(request, Response.error()))

const refuseTheConnection: ProxyAnswer = (request) =>
  Effect.fail(
    new HttpClientError.HttpClientError({
      reason: new HttpClientError.TransportError({ request, description: 'connection refused' }),
    }),
  )

const neverAnswer: ProxyAnswer = () => Effect.never

const start = Effect.fn('start')(function* (answer: ProxyAnswer) {
  const sent = yield* Ref.make<readonly SentRequest[]>([])

  const client = HttpClient.make((request, url) =>
    Effect.withFiber((fiber) =>
      Effect.andThen(
        Ref.update(sent, (requests) => [
          ...requests,
          {
            method: request.method,
            path: url.pathname,
            init: Context.getOption(fiber.context, FetchHttpClient.RequestInit),
          },
        ]),
        answer(request),
      ),
    ),
  )

  const context = yield* Layer.build(
    Layer.provide(SessionCheck.layerOnPage(PAGE), Layer.succeed(HttpClient.HttpClient, client)),
  )

  return { check: Context.get(context, SessionCheck), sent }
})

describe('SessionCheck.logOut', () => {
  it.effect(
    'posts the logout without following a redirect, and counts a status 0 as logged out',
    () =>
      Effect.gen(function* () {
        const { check, sent } = yield* start(answerWithStatusZero)

        yield* check.logOut

        expect(yield* Ref.get(sent)).toEqual([
          { method: 'POST', path: EXE_DEV_LOGOUT_PATH, init: Option.some(proxyRequestInit) },
        ])
      }),
  )

  it.effect('counts a 2xx answer as logged out', () =>
    Effect.gen(function* () {
      const { check } = yield* start(answerWith(200))
      const exit = yield* Effect.exit(check.logOut)

      expect(Exit.isSuccess(exit)).toBe(true)
    }),
  )

  it.effect('refuses with the status any other answer carries', () =>
    Effect.gen(function* () {
      const { check } = yield* start(answerWith(404))
      const failure = yield* Effect.flip(check.logOut)

      expect(failure).toEqual(new LogOutRefused({ status: 404 }))
    }),
  )

  it.effect('says what a refusal means and keeps its status off the phone', () =>
    Effect.gen(function* () {
      const { check } = yield* start(answerWith(500))
      const failure = yield* Effect.flip(check.logOut)

      expect(failure.message).toContain('may still be logged in')
      expect(failure.message).not.toMatch(/500|status/u)
    }),
  )

  it.effect('says exe.dev was unreachable when the request never got an answer', () =>
    Effect.gen(function* () {
      const { check } = yield* start(refuseTheConnection)
      const failure = yield* Effect.flip(check.logOut)

      expect(failure).toBeInstanceOf(LogOutUnreachable)
      expect(failure.message).toContain('connection refused')
    }),
  )

  it.effect('gives up once the session check timeout passes without an answer', () =>
    Effect.gen(function* () {
      const { check } = yield* start(neverAnswer)
      const attempt = yield* Effect.forkChild(Effect.flip(check.logOut), {
        startImmediately: true,
      })

      yield* TestClock.adjust(SESSION_CHECK_TIMEOUT)
      const failure = yield* Fiber.join(attempt)

      expect(failure).toBeInstanceOf(LogOutUnreachable)
      expect(failure.message).toContain('no answer within')
    }),
  )
})

describe('SessionCheck.expired', () => {
  it.effect('reads a redirected health check as an expired login', () =>
    Effect.gen(function* () {
      const { check, sent } = yield* start(answerWithStatusZero)

      expect(yield* check.expired).toBe(true)
      expect(yield* Ref.get(sent)).toEqual([
        { method: 'GET', path: HEALTH_PATH, init: Option.some(proxyRequestInit) },
      ])
    }),
  )

  it.effect('reads an answered or unreachable health check as a login that holds', () =>
    Effect.gen(function* () {
      const answered = yield* start(answerWith(200))
      const unreachable = yield* start(refuseTheConnection)

      expect(yield* answered.check.expired).toBe(false)
      expect(yield* unreachable.check.expired).toBe(false)
    }),
  )
})
