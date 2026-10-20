import { expect, it } from '@effect/vitest'
import * as ConfigProvider from 'effect/ConfigProvider'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Queue from 'effect/Queue'
import * as Stream from 'effect/Stream'
import * as TestClock from 'effect/testing/TestClock'

import { ClaudeSessions } from '@crook/agent/ClaudeSessions'
import { GitBranches } from '@crook/agent/GitBranches'
import { MachineStateSync } from '@crook/agent/MachineStateSync'
import { ClaudeSessionId } from '@crook/domain/Ids'
import type { HerdrEvent, Subscription } from '@crook/herdr/Events'
import {
  HerdrClient,
  HerdrConnectionClosed,
  HerdrEventsLost,
  HerdrPaneNotFound,
  type HerdrSubscriptionError,
} from '@crook/herdr/HerdrClient'
import type { SessionSnapshot } from '@crook/herdr/Records'

import { agentInfo, paneInfo, sessionSnapshot } from './Fixtures'

interface FakeSubscription {
  readonly subscriptions: readonly Subscription[]
  readonly events: Queue.Queue<HerdrEvent, HerdrSubscriptionError>
}

const SESSION = ClaudeSessionId.make('cc70b540-d22a-4ea4-aaf9-a0db3ce151aa')
const BRANCH = 'feat/jc-97-98-registry-seen'

const paneClosed: HerdrEvent = {
  event: 'pane_closed',
  data: { type: 'pane_closed', pane_id: 'w1:p9', workspace_id: 'w1' },
}

const working = sessionSnapshot([agentInfo()])

const statusPanes = (subscription: FakeSubscription) =>
  subscription.subscriptions.flatMap((entry) =>
    entry.type === 'pane.agent_status_changed' ? [entry.pane_id] : [],
  )

const startSync = Effect.fn('startSync')(function* (
  initial: SessionSnapshot,
  subscribeFailures: readonly HerdrSubscriptionError[] = [],
) {
  const readStarted = yield* Queue.unbounded<void>()
  const replies = yield* Queue.unbounded<SessionSnapshot>()
  const failures = yield* Queue.unbounded<HerdrSubscriptionError>()
  const subscriptions = yield* Queue.unbounded<FakeSubscription>()

  yield* Queue.offer(replies, initial)
  yield* Queue.offerAll(failures, subscribeFailures)

  const herdr = Layer.mock(HerdrClient, {
    snapshot: Queue.offer(readStarted, undefined).pipe(Effect.andThen(Queue.take(replies))),
    subscribe: (entries) =>
      Queue.poll(failures).pipe(
        Effect.flatMap(Option.match({ onNone: () => Effect.void, onSome: Effect.fail })),
        Effect.andThen(Queue.unbounded<HerdrEvent, HerdrSubscriptionError>()),
        Effect.tap((events) => Queue.offer(subscriptions, { subscriptions: entries, events })),
        Effect.map(Stream.fromQueue),
      ),
  })
  const context = yield* Layer.build(
    Layer.provide(MachineStateSync.layer, [
      herdr,
      ClaudeSessions.layerTest(new Map([['w1:p1', SESSION]])),
      GitBranches.layerTest(new Map([['/home/jliocsar/Projects/crook', BRANCH]])),
      ConfigProvider.layer(ConfigProvider.fromUnknown({ CROOK_MACHINE_ID: 'laptop' })),
    ]),
  )

  yield* Queue.take(readStarted)

  const answerRead = (snapshot: SessionSnapshot) =>
    Queue.take(readStarted).pipe(Effect.andThen(Queue.offer(replies, snapshot)))

  return {
    sync: Context.get(context, MachineStateSync),
    subscriptions,
    readStarted,
    replies,
    answerRead,
  }
})

const stateAt = (sync: MachineStateSync['Service'], version: number) =>
  sync.changes.pipe(
    Stream.filter((state) => state.version === version),
    Stream.runHead,
    Effect.flatMap(Effect.fromOption),
  )

it.effect('starts from the herdr snapshot as version 0', () =>
  Effect.gen(function* () {
    const { sync } = yield* startSync(working)
    const state = yield* sync.current

    expect(state.machine).toBe('laptop')
    expect(state.version).toBe(0)
    expect(state.herdrVersion).toBe('0.9.1')
    expect(
      state.agents.map((row) => [row.pane, row.status, row.claudeSession, row.branch]),
    ).toEqual([['w1:p1', 'working', Option.some(SESSION), Option.some(BRANCH)]])
  }),
)

it.effect('subscribes to status changes for every agent pane', () =>
  Effect.gen(function* () {
    const { subscriptions } = yield* startSync(working)
    const subscription = yield* Queue.take(subscriptions)

    expect(statusPanes(subscription)).toEqual(['w1:p1'])
    expect(subscription.subscriptions).toContainEqual({ type: 'pane.closed' })
  }),
)

it.effect('re-reads on every event and bumps the version only when the state changed', () =>
  Effect.gen(function* () {
    const { sync, subscriptions, answerRead } = yield* startSync(working)
    const subscription = yield* Queue.take(subscriptions)

    yield* answerRead(working)
    yield* Queue.offer(subscription.events, paneClosed)
    yield* answerRead(working)
    yield* Queue.offer(subscription.events, paneClosed)
    yield* answerRead(sessionSnapshot([agentInfo({ agent_status: 'blocked' })]))

    const state = yield* stateAt(sync, 1)

    expect(state.agents.map((row) => row.status)).toEqual(['blocked'])
  }),
)

it.effect('re-reads when asked to, for a change herdr announces no event for', () =>
  Effect.gen(function* () {
    const { sync, subscriptions, answerRead } = yield* startSync(working)

    yield* Queue.take(subscriptions)
    yield* answerRead(working)
    yield* sync.invalidate
    yield* answerRead(
      sessionSnapshot([agentInfo()], [paneInfo({ label: Option.some('Payments') })]),
    )

    const state = yield* stateAt(sync, 1)

    expect(state.agents.map((row) => row.label)).toEqual([Option.some('Payments')])
  }),
)

it.effect('coalesces a burst of events that lands during a read into one more read', () =>
  Effect.gen(function* () {
    const { sync, subscriptions, readStarted, replies, answerRead } = yield* startSync(working)
    const subscription = yield* Queue.take(subscriptions)

    yield* Queue.take(readStarted)
    yield* Queue.offerAll(subscription.events, [paneClosed, paneClosed, paneClosed])
    yield* Queue.offer(replies, working)
    yield* answerRead(sessionSnapshot([agentInfo({ agent_status: 'blocked' })]))
    yield* stateAt(sync, 1)
    yield* TestClock.adjust(0)

    expect(yield* Queue.size(readStarted)).toBe(0)
  }),
)

it.effect('resubscribes with the new pane set when an agent appears', () =>
  Effect.gen(function* () {
    const { subscriptions, answerRead } = yield* startSync(working)
    const first = yield* Queue.take(subscriptions)

    yield* answerRead(working)
    yield* Queue.offer(first.events, paneClosed)
    yield* answerRead(sessionSnapshot([agentInfo(), agentInfo({ pane_id: 'w1:p2' })]))

    const second = yield* Queue.take(subscriptions)

    expect(statusPanes(second).toSorted()).toEqual(['w1:p1', 'w1:p2'])
  }),
)

it.effect('resubscribes and re-reads after herdr drops events', () =>
  Effect.gen(function* () {
    const { sync, subscriptions, answerRead } = yield* startSync(working)
    const first = yield* Queue.take(subscriptions)

    yield* answerRead(working)
    yield* Queue.fail(first.events, new HerdrEventsLost())

    const second = yield* Queue.take(subscriptions)

    yield* answerRead(sessionSnapshot([agentInfo({ agent_status: 'idle' })]))

    const state = yield* stateAt(sync, 1)

    expect(statusPanes(second)).toEqual(['w1:p1'])
    expect(state.agents.map((row) => row.status)).toEqual(['idle'])
  }),
)

it.effect('re-reads before resubscribing when a subscribed pane has closed', () =>
  Effect.gen(function* () {
    const { sync, subscriptions, answerRead } = yield* startSync(
      sessionSnapshot([agentInfo(), agentInfo({ pane_id: 'w1:p2' })]),
      [new HerdrPaneNotFound({ method: 'events.subscribe', detail: 'pane not found' })],
    )

    yield* answerRead(working)

    const subscription = yield* Queue.take(subscriptions)

    yield* answerRead(working)

    const state = yield* stateAt(sync, 1)

    expect(statusPanes(subscription)).toEqual(['w1:p1'])
    expect(state.agents.map((row) => row.pane)).toEqual(['w1:p1'])
  }),
)

it.effect('waits the reconnect interval before trying herdr again', () =>
  Effect.gen(function* () {
    const { subscriptions } = yield* startSync(working, [
      new HerdrConnectionClosed({ method: 'events.subscribe' }),
    ])

    yield* TestClock.adjust(99)

    expect(yield* Queue.size(subscriptions)).toBe(0)

    yield* TestClock.adjust(1)

    expect(yield* Queue.size(subscriptions)).toBe(1)
  }),
)
