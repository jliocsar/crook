import { expect, it } from '@effect/vitest'
import * as Arr from 'effect/Array'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as Fiber from 'effect/Fiber'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Queue from 'effect/Queue'
import * as Stream from 'effect/Stream'
import type * as HttpClient from 'effect/http/HttpClient'
import type * as SqlClient from 'effect/sql/SqlClient'
import * as TestClock from 'effect/testing/TestClock'

import type { AgentRow } from '@crook/domain/AgentRow'
import type { AgentStatus } from '@crook/domain/AgentStatus'
import { HerdrLink } from '@crook/domain/HerdrLink'
import { HerdrConnectionId, MachineId, PaneId, TerminalId, WorkspaceId } from '@crook/domain/Ids'
import { MachineState, MachineStateVersion } from '@crook/domain/MachineState'
import { defaultNotificationPrefs } from '@crook/domain/Notifications'
import { Workspace } from '@crook/domain/Workspace'
import * as Database from '@crook/hub/Database'
import { HARK_REQUEST_SPACING, HarkClient, HarkNotificationId } from '@crook/hub/HarkClient'
import { HarkNotifier } from '@crook/hub/HarkNotifier'
import { Herd, RECONNECT_GRACE } from '@crook/hub/Herd'
import { SentNotification } from '@crook/hub/NotificationPlan'
import { NotificationStore } from '@crook/hub/NotificationStore'
import { SeenRecord, SeenTracker } from '@crook/hub/SeenTracker'
import { HarkNotConfigured, HarkReachedNoDevice } from '@crook/protocol/Hark'

import { PANE, agentRow, hello } from './Fixtures'
import {
  HARK_TOKEN,
  type HarkCall,
  type HarkScript,
  acceptingHark,
  created,
  fakeHark,
  harkIdFor,
  isWithdrawal,
  tokenConfig,
} from './HarkFakes'

const IN_MEMORY = ':memory:'
const LAPTOP = MachineId.make('laptop')
const TITLE = 'EX-253 Example feature'
const SECOND_PANE = PaneId.make('w1:p2')
const SECOND_TITLE = 'Port the herd'
const WITHDRAW_URL = `https://hark.ryan.ceo/api/agent/notifications/${harkIdFor(TITLE)}/withdraw`

const twoAgentsAt = (
  version: number,
  first: AgentRow,
  secondStatus: AgentStatus,
  secondStateChangeSeq: number,
  connection = 1,
) =>
  new MachineState({
    machine: LAPTOP,
    version: MachineStateVersion.make(version),
    herdrVersion: '0.9.5',
    herdr: new HerdrLink({ connection: HerdrConnectionId.make(connection), lostAt: Option.none() }),
    workspaces: [new Workspace({ id: WorkspaceId.make('w1'), label: 'crook' })],
    tabs: [],
    panes: [],
    agents: [
      first,
      agentRow({
        pane: SECOND_PANE,
        terminal: TerminalId.make('term_2'),
        title: SECOND_TITLE,
        status: secondStatus,
        stateChangeSeq: secondStateChangeSeq,
      }),
    ],
    places: [],
  })

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
    places: [],
  })

const notifierOver = (
  http: Layer.Layer<HttpClient.HttpClient>,
  token: Option.Option<string>,
  database: Context.Context<SqlClient.SqlClient>,
) =>
  Layer.provideMerge(
    HarkNotifier.layerWithoutDependencies,
    Layer.mergeAll(
      Herd.layer,
      HarkClient.layerWithoutDependencies,
      NotificationStore.layer,
      SeenTracker.layer,
    ),
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
    seenTracker: Context.get(context, SeenTracker),
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

it.effect(
  'withdraws a question and asks again when a new one follows with nothing published between',
  () =>
    Effect.gen(function* () {
      const { calls, start } = yield* withNotifier(acceptingHark)
      const { herd } = yield* start

      yield* herd.publish(LAPTOP, stateAt(1, 'working', 4))
      yield* herd.publish(LAPTOP, stateAt(2, 'blocked', 5))
      yield* nextCall(calls)
      yield* herd.publish(LAPTOP, stateAt(3, 'blocked', 7))
      const withdrawal = yield* nextCall(calls)
      const askedAgain = yield* nextCall(calls)

      expect(withdrawal.url).toBe(WITHDRAW_URL)
      expect(askedAgain.idempotencyKey).toEqual(
        Option.some('crook/laptop/w1:p1/term_1/7/questions'),
      )
    }).pipe(Effect.scoped),
)

const onlySecondAgentNotified = Effect.fn('onlySecondAgentNotified')(function* (
  calls: Queue.Dequeue<HarkCall>,
  herd: Herd['Service'],
  first: AgentRow,
  connection: number,
) {
  yield* herd.publish(LAPTOP, twoAgentsAt(3, first, 'blocked', 2, connection))
  const asked = yield* nextCall(calls)

  yield* herd.markSeen(LAPTOP, SECOND_PANE)
  const withdrawal = yield* nextCall(calls)

  return [asked.body, withdrawal.url]
})

const SECOND_ASKED = [
  Option.some({
    title: SECOND_TITLE,
    body: 'Has a question · laptop / crook',
    project: 'crook',
  }),
  `https://hark.ryan.ceo/api/agent/notifications/${harkIdFor(SECOND_TITLE)}/withdraw`,
]

it.effect('notifies nothing when an agent turns up done after a herdr resync', () =>
  Effect.gen(function* () {
    const { calls, start } = yield* withNotifier(acceptingHark)
    const { herd } = yield* start
    const done = agentRow({ status: 'done', stateChangeSeq: 7 })

    yield* herd.publish(
      LAPTOP,
      twoAgentsAt(1, agentRow({ status: 'working', stateChangeSeq: 6 }), 'working', 1),
    )
    yield* herd.publish(LAPTOP, twoAgentsAt(2, done, 'working', 1, 2))

    expect(yield* onlySecondAgentNotified(calls, herd, done, 2)).toEqual(SECOND_ASKED)
  }).pipe(Effect.scoped),
)

it.effect('notifies nothing for an event whose switch is off', () =>
  Effect.gen(function* () {
    const { calls, start } = yield* withNotifier(acceptingHark)
    const { herd, notifier } = yield* start
    const done = agentRow({ status: 'done', stateChangeSeq: 7 })

    yield* notifier.setPref('finished', false)
    yield* herd.publish(
      LAPTOP,
      twoAgentsAt(1, agentRow({ status: 'working', stateChangeSeq: 6 }), 'working', 1),
    )
    yield* herd.publish(LAPTOP, twoAgentsAt(2, done, 'working', 1))

    expect(yield* onlySecondAgentNotified(calls, herd, done, 1)).toEqual(SECOND_ASKED)
  }).pipe(Effect.scoped),
)

it.effect('gives up on a notification that hits a bug in the hub, and keeps notifying', () =>
  Effect.gen(function* () {
    const { calls, start } = yield* withNotifier((call) =>
      !isWithdrawal(call) && Option.exists(call.idempotencyKey, (key) => key.includes(PANE))
        ? 'broken'
        : acceptingHark(call),
    )
    const { herd } = yield* start
    const working = agentRow({ status: 'working', stateChangeSeq: 6 })

    yield* herd.publish(LAPTOP, twoAgentsAt(1, working, 'working', 1))
    yield* herd.publish(LAPTOP, twoAgentsAt(2, agentRow({ status: 'done' }), 'blocked', 2))
    const sends = [yield* nextCall(calls), yield* nextCall(calls)]

    yield* herd.markSeen(LAPTOP, SECOND_PANE)
    const withdrawal = yield* nextCall(calls)

    expect(Arr.map(sends, (call) => call.url)).toEqual([
      'https://hark.ryan.ceo/api/agent/notifications',
      'https://hark.ryan.ceo/api/agent/notifications',
    ])
    expect(withdrawal.url).toBe(
      `https://hark.ryan.ceo/api/agent/notifications/${harkIdFor(SECOND_TITLE)}/withdraw`,
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

const retriedKeys = Effect.fn('retriedKeys')(function* (script: HarkScript) {
  const { calls, start } = yield* withNotifier(script)
  const { herd } = yield* start

  yield* herd.publish(LAPTOP, stateAt(1, 'working', 6))
  yield* herd.publish(LAPTOP, stateAt(2, 'done', 7))
  const refused = yield* nextCall(calls)
  const retried = yield* nextCall(calls)

  return [refused.idempotencyKey, retried.idempotencyKey]
})

it.effect(
  'tries again after Hark asks it to wait or fails on its side, with the same idempotency key',
  () =>
    Effect.gen(function* () {
      const finishedKey = Option.some('crook/laptop/w1:p1/term_1/7/finished')
      const limited = yield* retriedKeys(() => ({
        status: 429,
        body: { error: 'Rate limited', retryAfterSeconds: 60 },
        headers: { 'retry-after': '60' },
      }))
      const failing = yield* retriedKeys(() => ({
        status: 503,
        body: { error: 'Service unavailable' },
      }))

      expect(limited).toEqual([finishedKey, finishedKey])
      expect(failing).toEqual([finishedKey, finishedKey])
    }).pipe(Effect.scoped),
)

it.effect('withdraws the notifications of a machine forgotten from the herd', () =>
  Effect.gen(function* () {
    const { calls, start } = yield* withNotifier(acceptingHark)
    const { herd } = yield* start
    const attachment = yield* Effect.forkScoped(herd.hold(LAPTOP, hello), {
      startImmediately: true,
    })

    yield* herd.publish(LAPTOP, stateAt(1, 'working', 6))
    yield* herd.publish(LAPTOP, stateAt(2, 'done', 7))
    yield* nextCall(calls)
    yield* Fiber.interrupt(attachment)
    yield* TestClock.adjust(RECONNECT_GRACE)
    yield* herd.forget(LAPTOP)
    const withdrawal = yield* nextCall(calls)

    expect(withdrawal.url).toBe(WITHDRAW_URL)
  }).pipe(Effect.scoped),
)

it.effect('withdraws at startup what it sent for a machine no longer in the herd', () =>
  Effect.gen(function* () {
    const { calls, start } = yield* withNotifier(acceptingHark)
    const leftOver = new SentNotification({
      machine: MachineId.make('desk'),
      pane: PANE,
      event: 'finished',
      terminal: TerminalId.make('term_1'),
      stateChangeSeq: 7,
      title: TITLE,
      body: 'Finished · desk / crook',
      harkId: HarkNotificationId.make('anot_desk'),
    })

    yield* Effect.scoped(Effect.flatMap(start, ({ store }) => store.rememberSent(leftOver)))
    yield* start
    const withdrawal = yield* nextCall(calls)

    expect(withdrawal.url).toBe('https://hark.ryan.ceo/api/agent/notifications/anot_desk/withdraw')
  }).pipe(Effect.scoped),
)

it.effect('withdraws at startup what was seen in crook before the hub could withdraw it', () =>
  Effect.gen(function* () {
    const { calls, start } = yield* withNotifier(acceptingHark)
    const seenBeforeRestart = new SentNotification({
      machine: LAPTOP,
      pane: PANE,
      event: 'finished',
      terminal: TerminalId.make('term_1'),
      stateChangeSeq: 7,
      title: TITLE,
      body: 'Finished · laptop / crook',
      harkId: HarkNotificationId.make('anot_seen'),
    })

    yield* Effect.scoped(
      Effect.gen(function* () {
        const { herd, store, seenTracker } = yield* start

        yield* herd.publish(LAPTOP, stateAt(1, 'done', 7))
        yield* store.rememberSent(seenBeforeRestart)
        yield* seenTracker.mark(
          new SeenRecord({
            machine: LAPTOP,
            pane: PANE,
            terminal: TerminalId.make('term_1'),
            stateChangeSeq: 7,
          }),
        )
      }),
    )
    yield* start
    const withdrawal = yield* nextCall(calls)

    expect(withdrawal.url).toBe('https://hark.ryan.ceo/api/agent/notifications/anot_seen/withdraw')
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
