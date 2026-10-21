import { expect, it } from '@effect/vitest'
import * as Context from 'effect/Context'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Fiber from 'effect/Fiber'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Queue from 'effect/Queue'
import * as TestClock from 'effect/testing/TestClock'

import {
  HARK_REQUEST_SPACING,
  HarkClient,
  HarkNotification,
  HarkNotificationId,
} from '@crook/hub/HarkClient'
import {
  HarkNotConfigured,
  HarkRateLimited,
  HarkRefused,
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

    yield* client.withdraw(HarkNotificationId.make('anot_7MFuml'))
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

    expect(HARK_REQUEST_SPACING).toEqual(Duration.seconds(1))
    expect(callsBeforeSpacing).toBe(1)
    expect(yield* Queue.size(calls)).toBe(2)
  }).pipe(Effect.scoped),
)
