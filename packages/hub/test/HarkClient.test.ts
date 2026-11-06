import { expect, it } from '@effect/vitest'
import * as Arr from 'effect/Array'
import * as Context from 'effect/Context'
import * as DateTime from 'effect/DateTime'
import * as Deferred from 'effect/Deferred'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Fiber from 'effect/Fiber'
import * as Layer from 'effect/Layer'
import * as Logger from 'effect/Logger'
import * as Option from 'effect/Option'
import * as Queue from 'effect/Queue'
import * as Ref from 'effect/Ref'
import * as TestClock from 'effect/testing/TestClock'

import {
  HARK_REQUEST_SPACING,
  HARK_REQUEST_TIMEOUT,
  HarkActivityContent,
  HarkActivityGone,
  HarkApproval,
  HarkClient,
  HarkId,
  HarkNotification,
  makeTurns,
  pauseOrGiveUp,
} from '@crook/hub/HarkClient'
import {
  HarkAnswerUnreadable,
  HarkNotConfigured,
  HarkRateLimited,
  HarkRefused,
  HarkServerFailed,
  HarkStillProcessing,
  HarkUnreachable,
  harkFailureForTheLog,
} from '@crook/protocol/Hark'

import {
  HARK_TOKEN,
  type HarkScript,
  acceptingHark,
  type HarkAnswer,
  created,
  fakeHark,
  harkIdFor,
  interactionCreated,
  interactionRespondedTo,
  interactionWaited,
  isWait,
  tokenConfig,
} from './HarkFakes'

const FINISHED = new HarkNotification({
  title: 'EX-253 Example feature',
  body: 'Finished · laptop / crook',
  idempotencyKey: Option.some('crook/laptop/w1:p1/term_1/7/finished'),
})

const NOTIFICATION_ID = HarkId.make('anot_7MFuml')

const rememberingLog = (lines: string[]) =>
  new Set([
    Logger.make(({ message }) => {
      lines.push(String(message))
    }),
  ])

const withHarkClient = Effect.fn('withHarkClient')(function* (
  script: HarkScript,
  token: Option.Option<string> = Option.some(HARK_TOKEN),
) {
  const hark = yield* fakeHark(script)
  const context = yield* Layer.build(
    HarkClient.layer.pipe(Layer.provide([hark.layer, tokenConfig(token)])),
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
    expect(yield* Effect.flip(unreachable.client.withdraw(HarkId.make('anot_1')))).toBeInstanceOf(
      HarkUnreachable,
    )
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

it.effect('reads Retry-After as whole seconds in either form HTTP allows, at most the window', () =>
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
    const absurd = yield* limitedFor('1e16')
    const farOff = yield* limitedFor('Fri, 31 Dec 9999 23:59:59 GMT')

    expect(yield* Effect.flip(fractional.client.send(FINISHED))).toEqual(
      new HarkRateLimited({ retryAfterSeconds: Option.some(2) }),
    )
    expect(yield* Effect.flip(dated.client.send(FINISHED))).toEqual(
      new HarkRateLimited({ retryAfterSeconds: Option.some(60) }),
    )
    expect(yield* Effect.flip(garbled.client.send(FINISHED))).toEqual(
      new HarkRateLimited({ retryAfterSeconds: Option.none() }),
    )
    expect(yield* Effect.flip(absurd.client.send(FINISHED))).toEqual(
      new HarkRateLimited({ retryAfterSeconds: Option.some(60) }),
    )
    expect(yield* Effect.flip(farOff.client.send(FINISHED))).toEqual(
      new HarkRateLimited({ retryAfterSeconds: Option.some(60) }),
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
    expect(harkFailureForTheLog(failure)).toContain('anot_7MFuml')
    expect(failure.message).not.toContain('anot_7MFuml')
  }).pipe(Effect.scoped),
)

it.effect('starts without a token, disabled, and says how to enable it', () =>
  Effect.gen(function* () {
    const { calls, client } = yield* withHarkClient(acceptingHark, Option.none())
    const failure = yield* Effect.flip(client.send(FINISHED))

    expect(client.delivery).toBe('noToken')
    expect(failure).toEqual(new HarkNotConfigured())
    expect(failure.message).not.toContain('CROOK_HUB_HARK_TOKEN')
    expect(yield* Queue.size(calls)).toBe(0)
  }).pipe(Effect.scoped),
)

it.effect('names the setting in the hub log as it starts without a token', () => {
  const logged: string[] = []

  return Effect.gen(function* () {
    yield* withHarkClient(acceptingHark, Option.none())

    expect(logged.join('\n')).toContain('CROOK_HUB_HARK_TOKEN')
  }).pipe(Effect.provideService(Logger.CurrentLoggers, rememberingLog(logged)), Effect.scoped)
})

it.effect('logs what Hark said and what the phone is not told, when it gives up or retries', () => {
  const logged: string[] = []
  const refused = new HarkRefused({ status: 401, explanation: Option.some('token revoked') })
  const unreachable = new HarkUnreachable({ detail: 'connection reset' })

  return Effect.gen(function* () {
    yield* pauseOrGiveUp('a test', refused)

    const pausing = yield* Effect.forkChild(pauseOrGiveUp('a test', unreachable), {
      startImmediately: true,
    })

    yield* Fiber.interrupt(pausing)

    const lines = logged.join('\n')

    expect(lines).toContain('token revoked')
    expect(lines).toContain('CROOK_HUB_HARK_TOKEN')
    expect(lines).toContain('connection reset')
  }).pipe(Effect.provideService(Logger.CurrentLoggers, rememberingLog(logged)))
})

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

const APPROVAL = new HarkApproval({
  title: 'EX-253 Example feature',
  prompt: 'Wants to run Bash · laptop / crook',
  idempotencyKey: Option.some('crook/laptop/w1:p1/term_1/7/approvals/toolu_1'),
})

const WORKING = new HarkActivityContent({
  status: '1 working',
  detail: Option.none(),
  symbol: 'terminal',
})

it.effect('reads an approval as approved, denied, still pending or closed some other way', () =>
  Effect.gen(function* () {
    const statesOf = Effect.fn('statesOf')(function* (status: string) {
      const { client } = yield* withHarkClient(() => interactionWaited(status))

      return (yield* client.awaitApproval(HarkId.make('int_1'))).state
    })
    const asked = yield* withHarkClient(() => interactionCreated('int_1'))

    expect(yield* asked.client.ask(APPROVAL)).toBe('int_1')
    expect(
      yield* Effect.forEach(['approved', 'denied', 'pending', 'canceled', 'expired'], statesOf),
    ).toEqual(['approved', 'denied', 'pending', 'closed', 'closed'])
  }).pipe(Effect.scoped),
)

it.effect('reads when an approval was answered, and does without a time it cannot read', () =>
  Effect.gen(function* () {
    const respondedAtOf = Effect.fn('respondedAtOf')(function* (answer: HarkAnswer) {
      const { client } = yield* withHarkClient(() => answer)

      return (yield* client.awaitApproval(HarkId.make('int_1'))).respondedAt
    })

    expect(
      yield* respondedAtOf(interactionRespondedTo('approved', '2026-07-25T18:06:52.000Z')),
    ).toEqual(Option.some(DateTime.makeUnsafe('2026-07-25T18:06:52.000Z')))
    expect(yield* respondedAtOf(interactionRespondedTo('approved', 'not a time'))).toEqual(
      Option.none(),
    )
    expect(yield* respondedAtOf(interactionWaited('approved'))).toEqual(Option.none())
  }).pipe(Effect.scoped),
)

it.effect(
  'takes a cancel of a prompt no longer pending, and an end of an ended activity, as done',
  () =>
    Effect.gen(function* () {
      const answering = (status: number) =>
        Effect.map(
          withHarkClient(() => ({ status, body: { error: 'Not pending or terminal' } })),
          (hark) => hark.client,
        )

      yield* Effect.flatMap(answering(404), (client) => client.cancel(HarkId.make('int_1')))
      yield* Effect.flatMap(answering(409), (client) => client.endActivity(WORKING, Duration.zero))
      const updatedEnded = yield* Effect.flatMap(answering(409), (client) =>
        Effect.flip(client.updateActivity(WORKING)),
      )
      const updatedUnknown = yield* Effect.flatMap(answering(404), (client) =>
        Effect.flip(client.updateActivity(WORKING)),
      )

      expect(updatedEnded).toEqual(new HarkActivityGone({ status: 409 }))
      expect(updatedUnknown).toEqual(new HarkActivityGone({ status: 404 }))
    }).pipe(Effect.scoped),
)

it.effect('lets other requests through while a long poll waits on Hark', () =>
  Effect.gen(function* () {
    const { calls, client } = yield* withHarkClient((call) =>
      isWait(call) ? 'silent' : created('anot_1'),
    )
    const waiting = yield* Effect.forkScoped(client.awaitApproval(HarkId.make('int_1')), {
      startImmediately: true,
    })

    yield* Queue.take(calls)
    const sending = yield* Effect.forkScoped(client.send(FINISHED), { startImmediately: true })

    yield* TestClock.adjust(HARK_REQUEST_SPACING)
    const sent = yield* Fiber.join(sending)

    yield* Fiber.interrupt(waiting)

    expect(sent.id).toBe('anot_1')
  }).pipe(Effect.scoped),
)

const turnsHeldOpen = Effect.gen(function* () {
  const inTurn = yield* makeTurns
  const holding = yield* Deferred.make<void>()
  const order = yield* Ref.make<readonly string[]>([])
  const holder = yield* Effect.forkScoped(inTurn(Deferred.await(holding)), {
    startImmediately: true,
  })
  const queueUp = (name: string) =>
    Effect.forkScoped(inTurn(Ref.update(order, Arr.append(name))), { startImmediately: true })
  const releaseHolder = Deferred.succeed(holding, undefined).pipe(
    Effect.andThen(Fiber.join(holder)),
  )

  return { inTurn, order, queueUp, releaseHolder }
})

it.effect('hands the turn to callers in the order they asked for it', () =>
  Effect.gen(function* () {
    const { order, queueUp, releaseHolder } = yield* turnsHeldOpen
    const waiting = yield* Effect.forEach(['first', 'second', 'third'], queueUp)

    yield* releaseHolder
    yield* Effect.forEach(waiting, Fiber.join)

    expect(yield* Ref.get(order)).toEqual(['first', 'second', 'third'])
  }).pipe(Effect.scoped),
)

it.effect('lets a caller interrupted in line leave it without holding up the others', () =>
  Effect.gen(function* () {
    const { inTurn, order, queueUp, releaseHolder } = yield* turnsHeldOpen
    const leaving = yield* queueUp('leaving')
    const staying = yield* queueUp('staying')

    yield* Fiber.interrupt(leaving)
    yield* releaseHolder
    yield* Fiber.join(staying)
    yield* inTurn(Ref.update(order, Arr.append('later')))

    expect(yield* Ref.get(order)).toEqual(['staying', 'later'])
  }).pipe(Effect.scoped),
)
