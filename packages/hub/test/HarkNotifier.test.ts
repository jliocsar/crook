import { expect, it } from '@effect/vitest'
import * as Arr from 'effect/Array'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Queue from 'effect/Queue'
import * as Stream from 'effect/Stream'
import type * as HttpClient from 'effect/http/HttpClient'
import type * as SqlClient from 'effect/sql/SqlClient'
import * as TestClock from 'effect/testing/TestClock'

import type { AgentStatus } from '@crook/domain/AgentStatus'
import { HerdrLink } from '@crook/domain/HerdrLink'
import { HerdrConnectionId, MachineId, WorkspaceId } from '@crook/domain/Ids'
import { MachineState, MachineStateVersion } from '@crook/domain/MachineState'
import { defaultNotificationPrefs } from '@crook/domain/Notifications'
import { Workspace } from '@crook/domain/Workspace'
import * as Database from '@crook/hub/Database'
import { HARK_REQUEST_SPACING, HarkClient } from '@crook/hub/HarkClient'
import { HarkNotifier } from '@crook/hub/HarkNotifier'
import { Herd } from '@crook/hub/Herd'
import { NotificationStore } from '@crook/hub/NotificationStore'
import { HarkNotConfigured, HarkReachedNoDevice } from '@crook/protocol/Hark'

import { PANE, agentRow } from './Fixtures'
import {
  HARK_TOKEN,
  type HarkCall,
  type HarkScript,
  acceptingHark,
  created,
  fakeHark,
  harkIdFor,
  tokenConfig,
} from './HarkFakes'

const IN_MEMORY = ':memory:'
const LAPTOP = MachineId.make('laptop')
const TITLE = 'EX-253 Example feature'
const WITHDRAW_URL = `https://hark.ryan.ceo/api/agent/notifications/${harkIdFor(TITLE)}/withdraw`

const stateAt = (version: number, status: AgentStatus, stateChangeSeq: number, connection = 1) =>
  new MachineState({
    machine: LAPTOP,
    version: MachineStateVersion.make(version),
    herdrVersion: '0.9.5',
    herdr: new HerdrLink({ connection: HerdrConnectionId.make(connection), lostAt: Option.none() }),
    workspaces: [new Workspace({ id: WorkspaceId.make('w1'), label: 'crook' })],
    tabs: [],
    panes: [],
    agents: [agentRow({ status, stateChangeSeq })],
  })

const notifierOver = (
  http: Layer.Layer<HttpClient.HttpClient>,
  token: Option.Option<string>,
  database: Context.Context<SqlClient.SqlClient>,
) =>
  Layer.provideMerge(
    HarkNotifier.layerWithoutDependencies,
    Layer.mergeAll(Herd.layer, HarkClient.layerWithoutDependencies, NotificationStore.layer),
  ).pipe(Layer.provide([http, tokenConfig(token), Layer.succeedContext(database)]))

const withNotifier = Effect.fn('withNotifier')(function* (
  script: HarkScript,
  token: Option.Option<string> = Option.some(HARK_TOKEN),
) {
  const hark = yield* fakeHark(script)
  const database = yield* Layer.build(Database.layerAt(IN_MEMORY))
  const start = Effect.map(Layer.build(notifierOver(hark.layer, token, database)), (context) => ({
    herd: Context.get(context, Herd),
    notifier: Context.get(context, HarkNotifier),
    store: Context.get(context, NotificationStore),
  }))

  return { calls: hark.calls, start }
})

const nextCall = (calls: Queue.Dequeue<HarkCall>) =>
  Effect.raceFirst(
    Queue.take(calls),
    TestClock.adjust(HARK_REQUEST_SPACING).pipe(Effect.andThen(Effect.yieldNow), Effect.forever),
  )

it.effect('notifies when an agent finishes, and withdraws it once it is seen in crook', () =>
  Effect.gen(function* () {
    const { calls, start } = yield* withNotifier(acceptingHark)
    const { herd } = yield* start

    yield* herd.publish(LAPTOP, stateAt(1, 'working', 6))
    yield* herd.publish(LAPTOP, stateAt(2, 'done', 7))
    const sent = yield* nextCall(calls)

    yield* herd.markSeen(LAPTOP, PANE)
    const withdrawal = yield* nextCall(calls)

    expect(sent.body).toEqual(
      Option.some({ title: TITLE, body: 'Finished · laptop / crook', project: 'crook' }),
    )
    expect(sent.idempotencyKey).toEqual(Option.some('crook/laptop/w1:p1/term_1/7/finished'))
    expect(withdrawal.url).toBe(WITHDRAW_URL)
  }).pipe(Effect.scoped),
)

it.effect('withdraws Finished when herdr turns done into idle without a new sequence', () =>
  Effect.gen(function* () {
    const { calls, start } = yield* withNotifier(acceptingHark)
    const { herd } = yield* start

    yield* herd.publish(LAPTOP, stateAt(1, 'working', 6))
    yield* herd.publish(LAPTOP, stateAt(2, 'done', 7))
    yield* nextCall(calls)
    yield* herd.publish(LAPTOP, stateAt(3, 'idle', 7))
    const withdrawal = yield* nextCall(calls)

    expect(withdrawal.url).toBe(WITHDRAW_URL)
  }).pipe(Effect.scoped),
)

it.effect('notifies nothing for a resync or for an event switched off', () =>
  Effect.gen(function* () {
    const { calls, start } = yield* withNotifier(acceptingHark)
    const { herd, notifier } = yield* start

    yield* herd.publish(LAPTOP, stateAt(1, 'working', 6))
    yield* herd.publish(LAPTOP, stateAt(2, 'done', 7, 2))
    yield* notifier.setPref('finished', false)
    yield* herd.publish(LAPTOP, stateAt(3, 'working', 8, 2))
    yield* herd.publish(LAPTOP, stateAt(4, 'done', 9, 2))
    yield* herd.publish(LAPTOP, stateAt(5, 'blocked', 10, 2))
    const first = yield* nextCall(calls)

    expect(first.body).toEqual(
      Option.some({ title: TITLE, body: 'Has a question · laptop / crook', project: 'crook' }),
    )
  }).pipe(Effect.scoped),
)

it.effect(
  'keeps a sent notification over a hub restart and withdraws it once the agent moved on',
  () =>
    Effect.gen(function* () {
      const { calls, start } = yield* withNotifier(acceptingHark)

      yield* Effect.scoped(
        Effect.gen(function* () {
          const { herd, store } = yield* start

          yield* herd.publish(LAPTOP, stateAt(1, 'working', 6))
          yield* herd.publish(LAPTOP, stateAt(2, 'done', 7))
          yield* nextCall(calls)
          yield* store.sent.pipe(
            Effect.tap(() => Effect.yieldNow),
            Effect.repeat({ until: Arr.isReadonlyArrayNonEmpty }),
          )
        }),
      )

      const { herd } = yield* start

      yield* herd.publish(LAPTOP, stateAt(1, 'idle', 7))
      const withdrawal = yield* nextCall(calls)

      expect(withdrawal.url).toBe(WITHDRAW_URL)
    }).pipe(Effect.scoped),
)

it.effect('tries again after Hark asks it to wait, with the same idempotency key', () =>
  Effect.gen(function* () {
    const { calls, start } = yield* withNotifier(() => ({
      status: 429,
      body: { error: 'Rate limited', retryAfterSeconds: 60 },
      headers: { 'retry-after': '60' },
    }))
    const { herd } = yield* start

    yield* herd.publish(LAPTOP, stateAt(1, 'working', 6))
    yield* herd.publish(LAPTOP, stateAt(2, 'done', 7))
    const refused = yield* nextCall(calls)
    const retried = yield* nextCall(calls)

    expect(refused.idempotencyKey).toEqual(Option.some('crook/laptop/w1:p1/term_1/7/finished'))
    expect(retried.idempotencyKey).toEqual(refused.idempotencyKey)
  }).pipe(Effect.scoped),
)

it.effect('stores the switches on the hub, shared by every device and kept over a restart', () =>
  Effect.gen(function* () {
    const { start } = yield* withNotifier(acceptingHark)
    const first = yield* start

    yield* first.notifier.setPref('finished', false)
    const restarted = yield* start
    const settings = yield* Stream.runHead(restarted.notifier.settings)

    expect(Option.map(settings, (current) => current.prefs)).toEqual(
      Option.some({ ...defaultNotificationPrefs, finished: false }),
    )
    expect(Option.map(settings, (current) => current.delivery)).toEqual(Option.some('ready'))
  }).pipe(Effect.scoped),
)

it.effect('sends a labels-only test, and says when no phone took it', () =>
  Effect.gen(function* () {
    const accepting = yield* withNotifier(acceptingHark)
    const unpaired = yield* withNotifier(() => created('anot_1', 0))
    const { notifier } = yield* accepting.start

    yield* notifier.sendTest
    const call = yield* Queue.take(accepting.calls)
    const noDevice = yield* Effect.flip((yield* unpaired.start).notifier.sendTest)

    expect(call.body).toEqual(
      Option.some({
        title: 'crook',
        body: 'Test · notifications from crook arrive like this',
        project: 'crook',
      }),
    )
    expect(noDevice).toEqual(new HarkReachedNoDevice())
  }).pipe(Effect.scoped),
)

it.effect('starts without a token, sends nothing and says it is not configured', () =>
  Effect.gen(function* () {
    const { calls, start } = yield* withNotifier(acceptingHark, Option.none())
    const { herd, notifier } = yield* start

    yield* herd.publish(LAPTOP, stateAt(1, 'working', 6))
    yield* herd.publish(LAPTOP, stateAt(2, 'done', 7))
    const settings = yield* Stream.runHead(notifier.settings)
    const testFailure = yield* Effect.flip(notifier.sendTest)

    expect(Option.map(settings, (current) => current.delivery)).toEqual(Option.some('noToken'))
    expect(testFailure).toEqual(new HarkNotConfigured())
    expect(yield* Queue.size(calls)).toBe(0)
  }).pipe(Effect.scoped),
)
