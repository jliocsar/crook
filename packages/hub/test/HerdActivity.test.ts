import { expect, it } from '@effect/vitest'
import * as Arr from 'effect/Array'
import * as Clock from 'effect/Clock'
import * as Context from 'effect/Context'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import type * as HttpClient from 'effect/http/HttpClient'
import type * as SqlClient from 'effect/sql/SqlClient'
import * as TestClock from 'effect/testing/TestClock'

import type { AgentRow } from '@crook/domain/AgentRow'
import { HerdrLink } from '@crook/domain/HerdrLink'
import { HerdrConnectionId, MachineId, PaneId, TerminalId, WorkspaceId } from '@crook/domain/Ids'
import { MachineState, MachineStateVersion } from '@crook/domain/MachineState'
import { Workspace } from '@crook/domain/Workspace'
import {
  ACTIVITY_RESTART_MARGIN,
  ACTIVITY_START_SPACING,
  ALL_DONE_LINGER,
} from '@crook/hub/ActivityPlan'
import { AuditTrail } from '@crook/hub/AuditTrail'
import { CommandRouter } from '@crook/hub/CommandRouter'
import * as Database from '@crook/hub/Database'
import { HARK_ACTIVITY_LIFETIME, HarkClient } from '@crook/hub/HarkClient'
import { HarkNotifier } from '@crook/hub/HarkNotifier'
import * as HerdActivity from '@crook/hub/HerdActivity'
import { Herd, RECONNECT_GRACE } from '@crook/hub/Herd'
import { NotificationStore } from '@crook/hub/NotificationStore'
import { SeenTracker } from '@crook/hub/SeenTracker'

import { agentRow, bashAsk } from './Fixtures'
import {
  HARK_TOKEN,
  type HarkCall,
  type HarkReply,
  type HarkScript,
  activityChanged,
  answeringFirst,
  callsWithin,
  created,
  fakeHark,
  interactionCreated,
  interactionWaited,
  isActivityCall,
  isAskCreation,
  isWait,
  nextCallWhere,
  tokenConfig,
} from './HarkFakes'

const IN_MEMORY = ':memory:'
const LAPTOP = MachineId.make('laptop')
const TITLE = 'EX-253 Example feature'
const ACTIVITIES_URL = 'https://hark.ryan.ceo/api/agent/activities'
const ACTIVITY_URL = `${ACTIVITIES_URL}/crook-herd`

const stateWith = (version: number, agents: readonly AgentRow[], connection = 1) =>
  new MachineState({
    machine: LAPTOP,
    version: MachineStateVersion.make(version),
    herdrVersion: '0.9.5',
    herdr: new HerdrLink({ connection: HerdrConnectionId.make(connection), lostAt: Option.none() }),
    workspaces: [new Workspace({ id: WorkspaceId.make('w1'), label: 'crook' })],
    tabs: [],
    panes: [],
    agents,
    places: [],
  })

const stateAt = (version: number, status: AgentRow['status'], stateChangeSeq: number) =>
  stateWith(version, [agentRow({ status, stateChangeSeq })])

const blockedOnBashAt = (version: number) =>
  stateWith(version, [
    agentRow({ status: 'blocked', stateChangeSeq: 7, ask: Option.some(bashAsk('toolu_1')) }),
  ])

const harkWith =
  (activity: (method: string) => HarkReply): HarkScript =>
  (call) => {
    if (isActivityCall(call)) {
      return activity(call.method)
    }

    if (isAskCreation(call)) {
      return interactionCreated('int_1')
    }

    return isWait(call) ? interactionWaited('pending') : created('anot_1')
  }

const acceptingActivities = harkWith(() => activityChanged)

const twoWorkingAt = (version: number) =>
  stateWith(version, [
    agentRow({ status: 'working', stateChangeSeq: 6 }),
    agentRow({
      pane: PaneId.make('w1:p2'),
      terminal: TerminalId.make('term_2'),
      status: 'working',
      stateChangeSeq: 3,
    }),
  ])

const UNAVAILABLE: HarkReply = { status: 503, body: { error: 'Service unavailable' } }

const isStart = (call: HarkCall) => call.method === 'POST' && call.url === ACTIVITIES_URL

const isUpdate = (call: HarkCall) => call.method === 'PATCH'

const isEnd = (call: HarkCall) => call.url === `${ACTIVITY_URL}/end`

const failingOnce = (isFailing: (call: HarkCall) => boolean, failure: HarkReply) =>
  answeringFirst(isFailing, [failure], acceptingActivities)

const endpointOf = (call: HarkCall) => [call.method, call.url]

const activityOver = (
  http: Layer.Layer<HttpClient.HttpClient>,
  token: Option.Option<string>,
  database: Context.Context<SqlClient.SqlClient>,
) =>
  Layer.provideMerge(
    Layer.provideMerge(
      HerdActivity.layerWithoutDependencies,
      HarkNotifier.layerWithoutDependencies,
    ),
    Layer.mergeAll(
      Herd.layer,
      HarkClient.layerWithoutDependencies,
      NotificationStore.layer,
      SeenTracker.layer,
      CommandRouter.layer,
      AuditTrail.layer,
    ),
  ).pipe(Layer.provide([http, tokenConfig(token), Layer.succeedContext(database)]))

const withActivity = Effect.fn('withActivity')(function* (
  script: HarkScript,
  token: Option.Option<string> = Option.some(HARK_TOKEN),
) {
  const hark = yield* fakeHark(script)
  const database = yield* Layer.build(Database.layerAt(IN_MEMORY))
  const start = Effect.map(Layer.build(activityOver(hark.layer, token, database)), (context) => ({
    herd: Context.get(context, Herd),
    notifier: Context.get(context, HarkNotifier),
  }))

  return { calls: hark.calls, start }
})

it.effect(
  'starts one Live Activity when the herd turns busy, and updates it as the herd changes',
  () =>
    Effect.gen(function* () {
      const { calls, start } = yield* withActivity(acceptingActivities)
      const { herd } = yield* start

      yield* herd.publish(LAPTOP, stateAt(1, 'idle', 5))
      yield* herd.publish(LAPTOP, stateAt(2, 'working', 6))
      const started = yield* nextCallWhere(calls, isActivityCall)

      yield* herd.publish(LAPTOP, blockedOnBashAt(3))
      const updated = yield* nextCallWhere(calls, isActivityCall)

      yield* herd.publish(LAPTOP, blockedOnBashAt(4))
      const unchanged = Arr.filter(yield* callsWithin(calls, 5), isActivityCall)

      expect([started.method, started.url]).toEqual(['POST', ACTIVITIES_URL])
      expect(started.body).toEqual(
        Option.some({
          key: 'crook-herd',
          replace: true,
          title: 'crook',
          status: '1 working',
          detail: `${TITLE} · laptop`,
          symbol: 'terminal',
          accentColor: '#EEEBE4',
          expiresInSeconds: 28_800,
        }),
      )
      expect([updated.method, updated.url]).toEqual(['PATCH', ACTIVITY_URL])
      expect(updated.body).toEqual(
        Option.some({
          status: '1 needs you',
          detail: `${TITLE} wants Bash · laptop`,
          symbol: 'warning',
        }),
      )
      expect(unchanged).toEqual([])
    }).pipe(Effect.scoped),
)

it.effect(
  'ends on All done with a short linger, and starts again only a minute after the last start',
  () =>
    Effect.gen(function* () {
      const { calls, start } = yield* withActivity(acceptingActivities)
      const { herd } = yield* start

      yield* herd.publish(LAPTOP, stateAt(1, 'idle', 5))
      yield* herd.publish(LAPTOP, stateAt(2, 'working', 6))
      yield* nextCallWhere(calls, isActivityCall)
      const startedAt = yield* Clock.currentTimeMillis

      yield* herd.publish(LAPTOP, stateAt(3, 'done', 7))
      const ended = yield* nextCallWhere(calls, isActivityCall)

      yield* herd.publish(LAPTOP, stateAt(4, 'working', 8))
      const restarted = yield* nextCallWhere(calls, isActivityCall)
      const restartedAt = yield* Clock.currentTimeMillis

      expect([ended.method, ended.url]).toEqual(['POST', `${ACTIVITY_URL}/end`])
      expect(ended.body).toEqual(
        Option.some({
          status: 'All done',
          detail: null,
          symbol: 'success',
          accentColor: '#EEEBE4',
          dismissAfterSeconds: 45,
        }),
      )
      expect([restarted.method, restarted.url]).toEqual(['POST', ACTIVITIES_URL])
      expect(restartedAt - startedAt).toBeGreaterThanOrEqual(
        Duration.toMillis(ACTIVITY_START_SPACING),
      )
    }).pipe(Effect.scoped),
)

it.effect('changes nothing on a herdr resync, even one that empties the herd for a moment', () =>
  Effect.gen(function* () {
    const { calls, start } = yield* withActivity(acceptingActivities)
    const { herd } = yield* start

    yield* herd.publish(LAPTOP, stateAt(1, 'working', 6))
    yield* nextCallWhere(calls, isActivityCall)
    yield* herd.publish(LAPTOP, stateWith(2, [], 2))
    yield* herd.publish(
      LAPTOP,
      stateWith(
        3,
        [agentRow({ status: 'working', stateChangeSeq: 1, terminal: TerminalId.make('term_9') })],
        2,
      ),
    )

    expect(Arr.filter(yield* callsWithin(calls, 120), isActivityCall)).toEqual([])
  }).pipe(Effect.scoped),
)

it.effect('restarts with its fixed key and replace before Hark expires it', () =>
  Effect.gen(function* () {
    const { calls, start } = yield* withActivity(acceptingActivities)
    const { herd } = yield* start

    yield* herd.publish(LAPTOP, stateAt(1, 'working', 6))
    const started = yield* nextCallWhere(calls, isActivityCall)

    yield* TestClock.adjust(Duration.subtract(HARK_ACTIVITY_LIFETIME, ACTIVITY_RESTART_MARGIN))
    const restarted = yield* nextCallWhere(calls, isActivityCall)

    expect([restarted.method, restarted.url]).toEqual(['POST', ACTIVITIES_URL])
    expect(restarted.body).toEqual(started.body)
  }).pipe(Effect.scoped),
)

it.effect('starts a new one when Hark says the old one has ended', () =>
  Effect.gen(function* () {
    const { calls, start } = yield* withActivity(
      harkWith((method) =>
        method === 'PATCH'
          ? { status: 409, body: { error: 'Live Activity is already terminal' } }
          : activityChanged,
      ),
    )
    const { herd } = yield* start

    yield* herd.publish(LAPTOP, stateAt(1, 'working', 6))
    yield* nextCallWhere(calls, isActivityCall)
    yield* herd.publish(LAPTOP, blockedOnBashAt(2))
    const refused = yield* nextCallWhere(calls, isActivityCall)
    const started = yield* nextCallWhere(calls, isActivityCall)

    expect(refused.method).toBe('PATCH')
    expect([started.method, started.url]).toEqual(['POST', ACTIVITIES_URL])
  }).pipe(Effect.scoped),
)

it.effect('ends at once when its switch is turned off', () =>
  Effect.gen(function* () {
    const { calls, start } = yield* withActivity(acceptingActivities)
    const { herd, notifier } = yield* start

    yield* herd.publish(LAPTOP, stateAt(1, 'working', 6))
    yield* nextCallWhere(calls, isActivityCall)
    yield* notifier.setPref('liveActivity', false)
    const ended = yield* nextCallWhere(calls, isActivityCall)

    expect(ended.url).toBe(`${ACTIVITY_URL}/end`)
    expect(ended.body).toEqual(
      Option.some({
        status: '1 working',
        detail: `${TITLE} · laptop`,
        symbol: 'terminal',
        accentColor: '#EEEBE4',
        dismissAfterSeconds: 0,
      }),
    )
  }).pipe(Effect.scoped),
)

it.effect('keeps its activity over a hub restart instead of starting another', () =>
  Effect.gen(function* () {
    const { calls, start } = yield* withActivity(acceptingActivities)

    yield* Effect.scoped(
      Effect.gen(function* () {
        const { herd } = yield* start

        yield* herd.publish(LAPTOP, stateAt(1, 'working', 6))
        yield* nextCallWhere(calls, isActivityCall)
      }),
    )

    const { herd } = yield* start

    yield* herd.publish(LAPTOP, stateAt(1, 'working', 6))
    const afterRestart = Arr.filter(yield* callsWithin(calls, 30), isActivityCall)

    yield* herd.publish(LAPTOP, stateAt(2, 'done', 7))
    const ended = yield* nextCallWhere(calls, isActivityCall)

    expect(afterRestart).toEqual([])
    expect(ended.url).toBe(`${ACTIVITY_URL}/end`)
  }).pipe(Effect.scoped),
)

it.effect('starts without a token and drives no Live Activity', () =>
  Effect.gen(function* () {
    const { calls, start } = yield* withActivity(acceptingActivities, Option.none())
    const { herd } = yield* start

    yield* herd.publish(LAPTOP, stateAt(1, 'idle', 5))
    yield* herd.publish(LAPTOP, stateAt(2, 'working', 6))

    expect(yield* callsWithin(calls, 5)).toEqual([])
  }).pipe(Effect.scoped),
)

const startTriedAfter = Effect.fn('startTriedAfter')(function* (failure: HarkReply) {
  const { calls, start } = yield* withActivity(failingOnce(isStart, failure))
  const { herd } = yield* start

  yield* herd.publish(LAPTOP, stateAt(1, 'working', 6))
  const failed = yield* nextCallWhere(calls, isActivityCall)
  const retried = yield* nextCallWhere(calls, isActivityCall)

  yield* herd.publish(LAPTOP, twoWorkingAt(2))
  const updated = yield* nextCallWhere(calls, isActivityCall)

  return Arr.map([failed, retried, updated], endpointOf)
})

const STARTED_THEN_UPDATED = [
  ['POST', ACTIVITIES_URL],
  ['POST', ACTIVITIES_URL],
  ['PATCH', ACTIVITY_URL],
]

it.effect(
  'tries a start again after Hark fails on its side, and counts it as live once it lands',
  () =>
    Effect.gen(function* () {
      expect(yield* startTriedAfter(UNAVAILABLE)).toEqual(STARTED_THEN_UPDATED)
    }).pipe(Effect.scoped),
)

it.effect(
  'tries a start again after Hark was unreachable, and counts it as live once it lands',
  () =>
    Effect.gen(function* () {
      expect(yield* startTriedAfter('unreachable')).toEqual(STARTED_THEN_UPDATED)
    }).pipe(Effect.scoped),
)

it.effect('tries a rate-limited start again once the wait Hark names has passed', () =>
  Effect.gen(function* () {
    const { calls, start } = yield* withActivity(
      failingOnce(isStart, {
        status: 429,
        body: { error: 'Rate limited' },
        headers: { 'retry-after': '30' },
      }),
    )
    const { herd } = yield* start

    yield* herd.publish(LAPTOP, stateAt(1, 'working', 6))
    yield* nextCallWhere(calls, isActivityCall)
    const limitedAt = yield* Clock.currentTimeMillis
    const retried = yield* nextCallWhere(calls, isActivityCall)
    const retriedAt = yield* Clock.currentTimeMillis

    expect(endpointOf(retried)).toEqual(['POST', ACTIVITIES_URL])
    expect(retriedAt - limitedAt).toBeGreaterThanOrEqual(Duration.toMillis(Duration.seconds(30)))
  }).pipe(Effect.scoped),
)

it.effect('tries an update again after an outage with the same content', () =>
  Effect.gen(function* () {
    const { calls, start } = yield* withActivity(failingOnce(isUpdate, UNAVAILABLE))
    const { herd } = yield* start

    yield* herd.publish(LAPTOP, stateAt(1, 'working', 6))
    yield* nextCallWhere(calls, isActivityCall)
    yield* herd.publish(LAPTOP, blockedOnBashAt(2))
    const failed = yield* nextCallWhere(calls, isActivityCall)
    const retried = yield* nextCallWhere(calls, isActivityCall)

    expect(endpointOf(failed)).toEqual(['PATCH', ACTIVITY_URL])
    expect(endpointOf(retried)).toEqual(['PATCH', ACTIVITY_URL])
    expect(retried.body).toEqual(failed.body)
  }).pipe(Effect.scoped),
)

it.effect('keeps a card whose end failed, and ends it once Hark is back', () =>
  Effect.gen(function* () {
    const { calls, start } = yield* withActivity(failingOnce(isEnd, UNAVAILABLE))
    const { herd } = yield* start

    yield* herd.publish(LAPTOP, stateAt(1, 'working', 6))
    yield* nextCallWhere(calls, isActivityCall)
    yield* herd.publish(LAPTOP, stateAt(2, 'done', 7))
    const failed = yield* nextCallWhere(calls, isActivityCall)
    const retried = yield* nextCallWhere(calls, isActivityCall)

    yield* herd.publish(LAPTOP, stateAt(3, 'working', 8))
    const restarted = yield* nextCallWhere(calls, isActivityCall)

    expect(Arr.map([failed, retried, restarted], endpointOf)).toEqual([
      ['POST', `${ACTIVITY_URL}/end`],
      ['POST', `${ACTIVITY_URL}/end`],
      ['POST', ACTIVITIES_URL],
    ])
  }).pipe(Effect.scoped),
)

it.effect('tries a refused start once per busy spell', () =>
  Effect.gen(function* () {
    const { calls, start } = yield* withActivity(
      harkWith((method) =>
        method === 'POST'
          ? { status: 402, body: { error: 'Live Activities need Hark Pro' } }
          : activityChanged,
      ),
    )
    const { herd } = yield* start

    yield* herd.publish(LAPTOP, stateAt(1, 'working', 6))
    const refused = yield* nextCallWhere(calls, isActivityCall)

    yield* herd.publish(LAPTOP, blockedOnBashAt(2))
    const whileBusy = Arr.filter(yield* callsWithin(calls, 70), isActivityCall)

    yield* herd.publish(LAPTOP, stateAt(3, 'done', 8))
    const whileIdle = Arr.filter(yield* callsWithin(calls, 1), isActivityCall)

    yield* herd.publish(LAPTOP, stateAt(4, 'working', 9))
    const nextSpell = yield* nextCallWhere(calls, isActivityCall)

    expect(endpointOf(refused)).toEqual(['POST', ACTIVITIES_URL])
    expect(whileBusy).toEqual([])
    expect(whileIdle).toEqual([])
    expect(endpointOf(nextSpell)).toEqual(['POST', ACTIVITIES_URL])
  }).pipe(Effect.scoped),
)

it.effect('ends the card a grace after a herdr resync empties the herd for good', () =>
  Effect.gen(function* () {
    const { calls, start } = yield* withActivity(acceptingActivities)
    const { herd } = yield* start

    yield* herd.publish(LAPTOP, stateAt(1, 'working', 6))
    yield* nextCallWhere(calls, isActivityCall)
    yield* TestClock.adjust(RECONNECT_GRACE)
    yield* herd.publish(LAPTOP, stateWith(2, [], 2))
    const resyncAt = yield* Clock.currentTimeMillis
    const ended = yield* nextCallWhere(calls, isActivityCall)
    const endedAt = yield* Clock.currentTimeMillis

    expect(endpointOf(ended)).toEqual(['POST', `${ACTIVITY_URL}/end`])
    expect(ended.body).toEqual(
      Option.some({
        status: 'All done',
        detail: null,
        symbol: 'success',
        accentColor: '#EEEBE4',
        dismissAfterSeconds: Duration.toSeconds(ALL_DONE_LINGER),
      }),
    )
    expect(endedAt - resyncAt).toBeGreaterThanOrEqual(Duration.toMillis(RECONNECT_GRACE))
  }).pipe(Effect.scoped),
)

it.effect('starts no card when only a herdr resync turned the herd busy', () =>
  Effect.gen(function* () {
    const { calls, start } = yield* withActivity(acceptingActivities)
    const { herd } = yield* start

    yield* herd.publish(LAPTOP, stateAt(1, 'idle', 5))
    yield* herd.publish(
      LAPTOP,
      stateWith(
        2,
        [agentRow({ status: 'working', stateChangeSeq: 1, terminal: TerminalId.make('term_9') })],
        2,
      ),
    )

    expect(Arr.filter(yield* callsWithin(calls, 70), isActivityCall)).toEqual([])
  }).pipe(Effect.scoped),
)
