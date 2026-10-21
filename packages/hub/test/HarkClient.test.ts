import { expect, it } from '@effect/vitest'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as Fiber from 'effect/Fiber'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Queue from 'effect/Queue'
import * as TestClock from 'effect/testing/TestClock'

import {
  HARK_REQUEST_SPACING,
  HARK_REQUEST_TIMEOUT,
  HarkClient,
  HarkNotification,
  HarkNotificationId,
} from '@crook/hub/HarkClient'
import {
  HarkAnswerUnreadable,
  HarkNotConfigured,
  HarkRateLimited,
  HarkRefused,
  HarkServerFailed,
  HarkStillProcessing,
  HarkUnreachable,
} from '@crook/protocol/Hark'

import {
  HARK_TOKEN,
  type HarkScript,
  acceptingHark,
  created,
  fakeHark,
  harkIdFor,
  tokenConfig,
} from './HarkFakes'

const FINISHED = new HarkNotification({
  title: 'EX-253 Example feature',
  body: 'Finished · laptop / crook',
  idempotencyKey: Option.some('crook/laptop/w1:p1/term_1/7/finished'),
})

const NOTIFICATION_ID = HarkNotificationId.make('anot_7MFuml')

const withHarkClient = Effect.fn('withHarkClient')(function* (
  script: HarkScript,
  token: Option.Option<string> = Option.some(HARK_TOKEN),
) {
  const hark = yield* fakeHark(script)
  const context = yield* Layer.build(
    HarkClient.layerWithoutDependencies.pipe(Layer.provide([hark.layer, tokenConfig(token)])),
  )

  return { calls: hark.calls, client: Context.get(context, HarkClient) }
})

it.effect('posts a labels-only notification into the crook project with the bearer token', () =>
  Effect.gen(function* () {
    const { calls, client } = yield* withHarkClient(acceptingHark)
    const sent = yield* client.send(FINISHED)
    const call = yield* Queue.take(calls)

    expect(client.delivery).toBe('ready')
    expect(sent.id).toBe(harkIdFor(FINISHED.title))
    expect(sent.accepted).toBe(1)
    expect(call.method).toBe('POST')
    expect(call.url).toBe('https://hark.ryan.ceo/api/agent/notifications')
    expect(call.authorization).toEqual(Option.some(`Bearer ${HARK_TOKEN}`))
    expect(call.idempotencyKey).toEqual(FINISHED.idempotencyKey)
    expect(call.body).toEqual(
      Option.some({
        title: 'EX-253 Example feature',
        body: 'Finished · laptop / crook',
        project: 'crook',
      }),
    )
  }).pipe(Effect.scoped),
)

it.effect('withdraws a notification by its Hark id', () =>
  Effect.gen(function* () {
    const { calls, client } = yield* withHarkClient(acceptingHark)

    yield* client.withdraw(NOTIFICATION_ID)
    const call = yield* Queue.take(calls)

    expect(call.method).toBe('POST')
    expect(call.url).toBe('https://hark.ryan.ceo/api/agent/notifications/anot_7MFuml/withdraw')
    expect(call.body).toEqual(Option.none())
  }).pipe(Effect.scoped),
)

it.effect('names why Hark refused, ran out or could not be reached', () =>
  Effect.gen(function* () {
    const refused = yield* withHarkClient(() => ({
      status: 403,
      body: { error: 'Missing scope', required: ['notifications:send'] },
    }))
    const limited = yield* withHarkClient(() => ({
      status: 429,
      body: { error: 'Rate limited', retryAfterSeconds: 60 },
      headers: { 'retry-after': '60' },
    }))
    const exhausted = yield* withHarkClient(() => ({
      status: 429,
      body: { error: 'Monthly allowance exhausted' },
    }))
    const unreachable = yield* withHarkClient(() => 'unreachable')

    expect(yield* Effect.flip(refused.client.send(FINISHED))).toEqual(
      new HarkRefused({ status: 403, explanation: Option.some('Missing scope') }),
    )
    expect(yield* Effect.flip(limited.client.send(FINISHED))).toEqual(
      new HarkRateLimited({ retryAfterSeconds: Option.some(60) }),
    )
    expect(yield* Effect.flip(exhausted.client.send(FINISHED))).toEqual(
      new HarkRateLimited({ retryAfterSeconds: Option.none() }),
    )
    expect(
      yield* Effect.flip(unreachable.client.withdraw(HarkNotificationId.make('anot_1'))),
    ).toBeInstanceOf(HarkUnreachable)
  }).pipe(Effect.scoped),
)

it.effect('tells a passing failure on Hark side and a request still in flight from a refusal', () =>
  Effect.gen(function* () {
    const unavailable = () => ({ status: 503, body: { error: 'Service unavailable' } })
    const failingSend = yield* withHarkClient(unavailable)
    const failingWithdrawal = yield* withHarkClient(unavailable)
    const inFlight = yield* withHarkClient(() => ({ status: 202, body: { ok: true } }))
    const noDevice = yield* withHarkClient(() => ({
      status: 502,
      body: { error: 'No device accepted the command' },
    }))

    expect(yield* Effect.flip(failingSend.client.send(FINISHED))).toEqual(
      new HarkServerFailed({ status: 503, explanation: Option.some('Service unavailable') }),
    )
    expect(yield* Effect.flip(failingWithdrawal.client.withdraw(NOTIFICATION_ID))).toEqual(
      new HarkServerFailed({ status: 503, explanation: Option.some('Service unavailable') }),
    )
    expect(yield* Effect.flip(inFlight.client.send(FINISHED))).toEqual(new HarkStillProcessing())
    expect(yield* Effect.flip(noDevice.client.withdraw(NOTIFICATION_ID))).toEqual(
      new HarkRefused({ status: 502, explanation: Option.some('No device accepted the command') }),
    )
  }).pipe(Effect.scoped),
)

it.effect('reads Retry-After as whole seconds in either form HTTP allows, rounding up', () =>
  Effect.gen(function* () {
    const limitedFor = (retryAfter: string) =>
      withHarkClient(() => ({
        status: 429,
        body: { error: 'Rate limited' },
        headers: { 'retry-after': retryAfter },
      }))
    const fractional = yield* limitedFor('1.5')
    const dated = yield* limitedFor('Thu, 01 Jan 1970 00:01:00 GMT')
    const garbled = yield* limitedFor('soon')

    expect(yield* Effect.flip(fractional.client.send(FINISHED))).toEqual(
      new HarkRateLimited({ retryAfterSeconds: Option.some(2) }),
    )
    expect(yield* Effect.flip(dated.client.send(FINISHED))).toEqual(
      new HarkRateLimited({ retryAfterSeconds: Option.some(60) }),
    )
    expect(yield* Effect.flip(garbled.client.send(FINISHED))).toEqual(
      new HarkRateLimited({ retryAfterSeconds: Option.none() }),
    )
  }).pipe(Effect.scoped),
)

it.effect('gives up on a request Hark never answers, so the next one is not stuck behind it', () =>
  Effect.gen(function* () {
    const { calls, client } = yield* withHarkClient(() => 'silent')
    const first = yield* Effect.forkScoped(Effect.flip(client.send(FINISHED)), {
      startImmediately: true,
    })

    yield* TestClock.adjust(HARK_REQUEST_TIMEOUT)
    const failure = yield* Fiber.join(first)
    const second = yield* Effect.forkScoped(client.send(FINISHED), { startImmediately: true })

    yield* TestClock.adjust(HARK_REQUEST_SPACING)
    yield* Queue.take(calls)
    yield* Queue.take(calls)
    yield* Fiber.interrupt(second)

    expect(failure).toBeInstanceOf(HarkUnreachable)
  }).pipe(Effect.scoped),
)

it.effect('names the notification Hark created when its answer cannot be read', () =>
  Effect.gen(function* () {
    const { client } = yield* withHarkClient(() => ({
      status: 201,
      body: { notification: { id: 'anot_7MFuml' } },
    }))
    const failure = yield* Effect.flip(client.send(FINISHED))

    expect(failure).toBeInstanceOf(HarkAnswerUnreadable)
    expect(failure.message).toContain('anot_7MFuml')
  }).pipe(Effect.scoped),
)

it.effect('starts without a token, disabled, and says how to enable it', () =>
  Effect.gen(function* () {
    const { calls, client } = yield* withHarkClient(acceptingHark, Option.none())
    const failure = yield* Effect.flip(client.send(FINISHED))

    expect(client.delivery).toBe('noToken')
    expect(failure).toEqual(new HarkNotConfigured())
    expect(failure.message).toContain('CROOK_HUB_HARK_TOKEN')
    expect(yield* Queue.size(calls)).toBe(0)
  }).pipe(Effect.scoped),
)

it.effect('spaces its requests so a minute never holds more than Hark allows', () =>
  Effect.gen(function* () {
    const { calls, client } = yield* withHarkClient(() => created('anot_1'))

    yield* client.send(FINISHED)
    const second = yield* Effect.forkScoped(client.send(FINISHED), { startImmediately: true })
    const callsBeforeSpacing = yield* Queue.size(calls)

    yield* TestClock.adjust(HARK_REQUEST_SPACING)
    yield* Fiber.join(second)

    expect(callsBeforeSpacing).toBe(1)
    expect(yield* Queue.size(calls)).toBe(2)
  }).pipe(Effect.scoped),
)
