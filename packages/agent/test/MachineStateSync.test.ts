import { expect, it } from '@effect/vitest'
import * as Arr from 'effect/Array'
import * as ConfigProvider from 'effect/ConfigProvider'
import * as Context from 'effect/Context'
import * as DateTime from 'effect/DateTime'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Queue from 'effect/Queue'
import * as Ref from 'effect/Ref'
import * as Stream from 'effect/Stream'
import * as TestClock from 'effect/testing/TestClock'

import { ClaudeSessions } from '@crook/agent/ClaudeSessions'
import { CreatedPanes } from '@crook/agent/CreatedPanes'
import { GitBranches } from '@crook/agent/GitBranches'
import { RecentPlaces } from '@crook/agent/RecentPlaces'
import { HERDR_RECONNECT_BASE, MachineStateSync } from '@crook/agent/MachineStateSync'
import { PendingAsks } from '@crook/agent/PendingAsks'
import { type AgentRow, StatusBeforeHandoff } from '@crook/domain/AgentRow'
import { type Ask, UnknownAsk } from '@crook/domain/Ask'
import { AskId, ClaudeSessionId, PaneId } from '@crook/domain/Ids'
import { isHerdrLost, isResync, panePresence } from '@crook/domain/MachineState'
import { Checkout, Place } from '@crook/domain/Place'
import type { HerdrEvent, Subscription } from '@crook/herdr/Events'
import {
  HerdrClient,
  HerdrConnectionClosed,
  HerdrEventsLost,
  HerdrPaneNotFound,
  type HerdrSubscriptionError,
  HerdrUnreachable,
} from '@crook/herdr/HerdrClient'
import { agentInfo, paneInfo, sessionSnapshot, tabInfo } from '@crook/herdr/RecordFixtures'
import { type AgentInfo, type SessionSnapshot, TabInfo } from '@crook/herdr/Records'
import { RECONNECT_CAP } from '@crook/protocol/AgentLink'

interface FakeSubscription {
  readonly subscriptions: readonly Subscription[]
  readonly events: Queue.Queue<HerdrEvent, HerdrSubscriptionError>
}

const SESSION = ClaudeSessionId.make('cc70b540-d22a-4ea4-aaf9-a0db3ce151aa')
const HANDOFF_SESSION = ClaudeSessionId.make('5f0c2a8e-91d4-4b6e-a3c7-2e8d6b1f4a90')
const BRANCH = 'feat/jc-97-98-registry-seen'
const BACKOFF_ATTEMPTS = 8

const expectedBackoffMillis = Arr.makeBy(BACKOFF_ATTEMPTS, (attempt) =>
  Duration.toMillis(
    Duration.min(Duration.times(HERDR_RECONNECT_BASE, 2 ** attempt), RECONNECT_CAP),
  ),
)

const herdrStopped = new HerdrUnreachable({
  socketPath: '/home/jliocsar/.config/herdr/herdr.sock',
  cause: new Error('connect ENOENT /home/jliocsar/.config/herdr/herdr.sock'),
})

const lastPaneExited: HerdrEvent = {
  event: 'pane_exited',
  data: { type: 'pane_exited', pane_id: 'w1:p7', workspace_id: 'w1' },
}

const redetectedIdle: HerdrEvent = {
  event: 'pane.agent_status_changed',
  data: {
    pane_id: 'w1:p6',
    workspace_id: 'w1',
    agent_status: 'idle',
    agent: Option.some('claude'),
    display_agent: Option.none(),
    title: Option.none(),
  },
}

const exitTestTab = new TabInfo({
  tab_id: 'w1:t4',
  workspace_id: 'w1',
  number: 4,
  label: 'exit-test',
  focused: false,
  pane_count: 1,
  agent_status: 'unknown',
})

const handoffAgent = (fields: Partial<ConstructorParameters<typeof AgentInfo>[0]>) =>
  agentInfo({ pane_id: 'w1:p6', cwd: Option.none(), ...fields })

const beforeHandoff = sessionSnapshot([
  handoffAgent({
    terminal_id: 'term_65e4959ec32112',
    agent_status: 'idle',
    state_change_seq: 2,
    completion_seq: Option.some(2),
  }),
])

const afterHandoff = sessionSnapshot([
  handoffAgent({
    terminal_id: 'term_65e4981ac9ff02',
    agent_status: 'unknown',
    state_change_seq: 0,
  }),
])

const redetected = sessionSnapshot([
  handoffAgent({ terminal_id: 'term_65e4981ac9ff02', agent_status: 'idle', state_change_seq: 1 }),
])

const restartedWithoutAgents = sessionSnapshot([], [paneInfo({ terminal_id: 'term_restarted' })])

const paneClosed: HerdrEvent = {
  event: 'pane_closed',
  data: { type: 'pane_closed', pane_id: 'w1:p9', workspace_id: 'w1' },
}

const working = sessionSnapshot([agentInfo()])

const twoAgents = sessionSnapshot([agentInfo(), agentInfo({ pane_id: 'w1:p2' })])

const statusPanes = (subscription: FakeSubscription) =>
  subscription.subscriptions.flatMap((entry) =>
    entry.type === 'pane.agent_status_changed' ? [entry.pane_id] : [],
  )

const startSync = Effect.fn('startSync')(function* (
  initial: SessionSnapshot,
  subscribeFailures: readonly HerdrSubscriptionError[] = [],
  asks: ReadonlyMap<string, Ask> = new Map(),
  recentPlaces: Layer.Layer<RecentPlaces> = RecentPlaces.layerTest(),
) {
  const readStarted = yield* Queue.unbounded<void>()
  const replies = yield* Queue.unbounded<SessionSnapshot>()
  const failures = yield* Queue.unbounded<HerdrSubscriptionError>()
  const subscriptions = yield* Queue.unbounded<FakeSubscription>()
  const attempts = yield* Ref.make(0)

  yield* Queue.offer(replies, initial)
  yield* Queue.offerAll(failures, subscribeFailures)

  const herdr = Layer.mock(HerdrClient, {
    snapshot: Queue.offer(readStarted, undefined).pipe(Effect.andThen(Queue.take(replies))),
    subscribe: (entries) =>
      Ref.update(attempts, (count) => count + 1).pipe(
        Effect.andThen(Queue.poll(failures)),
        Effect.flatMap(Option.match({ onNone: () => Effect.void, onSome: Effect.fail })),
        Effect.andThen(Queue.unbounded<HerdrEvent, HerdrSubscriptionError>()),
        Effect.tap((events) => Queue.offer(subscriptions, { subscriptions: entries, events })),
        Effect.map(Stream.fromQueue),
      ),
  })
  const context = yield* Layer.build(
    Layer.provideMerge(MachineStateSync.layer, [
      herdr,
      CreatedPanes.layerTest(),
      PendingAsks.layerTest(asks),
      recentPlaces,
      ClaudeSessions.layerTest(
        new Map([
          ['w1:p1', SESSION],
          ['w1:p6', HANDOFF_SESSION],
        ]),
      ),
      GitBranches.layerTest(new Map([['/home/jliocsar/Projects/crook', BRANCH]])),
      ConfigProvider.layer(ConfigProvider.fromUnknown({ CROOK_MACHINE_ID: 'laptop' })),
    ]),
  )

  yield* Queue.take(readStarted)

  const answerRead = (snapshot: SessionSnapshot) =>
    Queue.take(readStarted).pipe(Effect.andThen(Queue.offer(replies, snapshot)))

  return {
    sync: Context.get(context, MachineStateSync),
    createdPanes: Context.get(context, CreatedPanes),
    subscriptions,
    readStarted,
    replies,
    failures,
    attempts,
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
    expect(subscription.subscriptions).toContainEqual({ type: 'tab.focused' })
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

it.effect('publishes the ask of a blocked agent, and drops it once the agent moves on', () =>
  Effect.gen(function* () {
    const ask = new UnknownAsk({ id: AskId.make('blocked-term-4'), screen: '' })
    const { sync, subscriptions, answerRead } = yield* startSync(
      working,
      [],
      new Map([['w1:p1', ask]]),
    )
    const subscription = yield* Queue.take(subscriptions)

    yield* answerRead(working)
    yield* Queue.offer(subscription.events, paneClosed)
    yield* answerRead(sessionSnapshot([agentInfo({ agent_status: 'blocked' })]))
    const blocked = yield* stateAt(sync, 1)
    yield* Queue.offer(subscription.events, paneClosed)
    yield* answerRead(working)
    const movedOn = yield* stateAt(sync, 2)

    expect(blocked.agents.map((row) => row.ask)).toEqual([Option.some(ask)])
    expect(movedOn.agents.map((row) => row.ask)).toEqual([Option.none()])
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

it.effect(
  'republishes the agents when crook remembers or forgets a pane, without asking herdr',
  () =>
    Effect.gen(function* () {
      const { sync, createdPanes, subscriptions, readStarted, answerRead } =
        yield* startSync(working)

      yield* Queue.take(subscriptions)
      yield* answerRead(working)
      yield* createdPanes.remember(PaneId.make('w1:p1'))
      const remembered = yield* stateAt(sync, 1)

      yield* createdPanes.forget(PaneId.make('w1:p1'))
      const forgotten = yield* stateAt(sync, 2)

      expect(remembered.agents.map((row) => row.createdByCrook)).toEqual([true])
      expect(forgotten.agents.map((row) => row.createdByCrook)).toEqual([false])
      expect(yield* Queue.size(readStarted)).toBe(0)
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
    yield* TestClock.adjust(RECONNECT_CAP)
    yield* Queue.fail(first.events, new HerdrEventsLost())
    yield* TestClock.adjust(HERDR_RECONNECT_BASE)

    const second = yield* Queue.take(subscriptions)

    yield* answerRead(sessionSnapshot([agentInfo({ agent_status: 'idle' })]))

    const state = yield* stateAt(sync, 1)

    expect(statusPanes(second)).toEqual(['w1:p1'])
    expect(state.agents.map((row) => row.status)).toEqual(['idle'])
  }),
)

it.effect('re-reads before resubscribing when a subscribed pane has closed', () =>
  Effect.gen(function* () {
    const { sync, subscriptions, answerRead } = yield* startSync(twoAgents, [
      new HerdrPaneNotFound({ method: 'events.subscribe', detail: 'pane not found' }),
    ])

    yield* answerRead(working)

    const subscription = yield* Queue.take(subscriptions)

    yield* answerRead(working)

    const state = yield* stateAt(sync, 1)

    expect(statusPanes(subscription)).toEqual(['w1:p1'])
    expect(state.agents.map((row) => row.pane)).toEqual(['w1:p1'])
    expect(isHerdrLost(state)).toBe(false)
  }),
)

it.effect('backs off when the re-read after pane_not_found still lists the same agent panes', () =>
  Effect.gen(function* () {
    const { sync, subscriptions, attempts, answerRead } = yield* startSync(twoAgents, [
      new HerdrPaneNotFound({ method: 'events.subscribe', detail: 'pane not found' }),
    ])

    yield* answerRead(twoAgents)
    const lost = yield* stateAt(sync, 1)

    yield* TestClock.adjust(Duration.subtract(HERDR_RECONNECT_BASE, Duration.millis(1)))
    const early = yield* Ref.get(attempts)

    yield* TestClock.adjust(1)
    const retried = yield* Queue.take(subscriptions)

    expect(isHerdrLost(lost)).toBe(true)
    expect(early).toBe(1)
    expect(statusPanes(retried).toSorted()).toEqual(['w1:p1', 'w1:p2'])
  }),
)

it.effect('keeps a connection healthy across a resubscribe for a new pane set', () =>
  Effect.gen(function* () {
    const { sync, subscriptions, answerRead } = yield* startSync(working)
    const first = yield* Queue.take(subscriptions)

    yield* answerRead(working)
    yield* TestClock.adjust(HERDR_RECONNECT_BASE)
    yield* Queue.offer(first.events, paneClosed)
    yield* answerRead(twoAgents)
    const second = yield* Queue.take(subscriptions)

    yield* answerRead(twoAgents)
    yield* TestClock.adjust(Duration.subtract(RECONNECT_CAP, HERDR_RECONNECT_BASE))
    yield* Queue.fail(second.events, new HerdrConnectionClosed({ method: 'events.subscribe' }))
    yield* TestClock.adjust(Duration.subtract(HERDR_RECONNECT_BASE, Duration.millis(1)))
    const early = yield* Queue.size(subscriptions)

    yield* TestClock.adjust(1)
    yield* Queue.take(subscriptions)

    expect(early).toBe(0)
    expect(isHerdrLost(yield* sync.current)).toBe(false)
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

it.effect('backs off exponentially from 100 ms up to the 5 s cap while herdr stays down', () =>
  Effect.gen(function* () {
    const { attempts } = yield* startSync(
      working,
      Arr.makeBy(BACKOFF_ATTEMPTS + 1, () => herdrStopped),
    )

    yield* TestClock.adjust(0)
    const firstAttempts = yield* Ref.get(attempts)
    const waits = yield* Effect.forEach(expectedBackoffMillis, (millis) =>
      Effect.gen(function* () {
        const before = yield* Ref.get(attempts)

        yield* TestClock.adjust(millis - 1)
        const early = yield* Ref.get(attempts)

        yield* TestClock.adjust(1)
        const onTime = yield* Ref.get(attempts)

        return [early - before, onTime - before]
      }),
    )

    expect(firstAttempts).toBe(1)
    expect(waits).toEqual(expectedBackoffMillis.map(() => [0, 1]))
  }),
)

it.effect(
  'reconnects after a handoff under a new herdr connection, without showing herdr lost',
  () =>
    Effect.gen(function* () {
      const { sync, subscriptions, answerRead } = yield* startSync(beforeHandoff)
      const first = yield* Queue.take(subscriptions)
      const initial = yield* sync.current

      yield* answerRead(beforeHandoff)
      yield* TestClock.adjust(RECONNECT_CAP)
      yield* Queue.fail(first.events, new HerdrConnectionClosed({ method: 'events.subscribe' }))
      yield* TestClock.adjust(Duration.subtract(HERDR_RECONNECT_BASE, Duration.millis(1)))

      expect(yield* Queue.size(subscriptions)).toBe(0)

      yield* TestClock.adjust(1)
      const second = yield* Queue.take(subscriptions)

      yield* answerRead(afterHandoff)
      const resynced = yield* stateAt(sync, 1)

      yield* Queue.offer(second.events, redetectedIdle)
      yield* answerRead(redetected)
      const settled = yield* stateAt(sync, 2)

      expect(initial.agents.map((row) => [row.pane, row.status, row.stateChangeSeq])).toEqual([
        ['w1:p6', 'idle', 2],
      ])
      expect(isResync(initial, resynced)).toBe(true)
      expect(isHerdrLost(resynced)).toBe(false)
      expect(
        resynced.agents.map((row) => [row.pane, row.terminal, row.status, row.stateChangeSeq]),
      ).toEqual([['w1:p6', 'term_65e4981ac9ff02', 'unknown', 0]])
      expect(isResync(resynced, settled)).toBe(false)
      expect(settled.agents.map((row) => [row.status, row.stateChangeSeq])).toEqual([['idle', 1]])

      const remembered = initial.agents.map((row) =>
        Option.some(
          new StatusBeforeHandoff({
            status: row.status,
            statusChangedAt: row.statusChangedAt,
            terminal: row.terminal,
            stateChangeSeq: row.stateChangeSeq,
          }),
        ),
      )

      expect(resynced.agents.map((row) => row.beforeHandoff)).toEqual(remembered)
      expect(settled.agents.map((row) => row.beforeHandoff)).toEqual(remembered)
      expect(settled.agents.map((row) => row.statusChangedAt)).toEqual(
        initial.agents.map((row) => row.statusChangedAt),
      )
    }),
)

it.effect('marks herdr lost when it does not come back, and clears it with the next read', () =>
  Effect.gen(function* () {
    const { sync, subscriptions, failures, answerRead } = yield* startSync(working)
    const first = yield* Queue.take(subscriptions)
    const initial = yield* sync.current

    yield* answerRead(working)
    yield* TestClock.adjust(RECONNECT_CAP)
    yield* Queue.offer(failures, herdrStopped)
    yield* Queue.fail(first.events, new HerdrConnectionClosed({ method: 'events.subscribe' }))
    yield* TestClock.adjust(HERDR_RECONNECT_BASE)
    const lost = yield* stateAt(sync, 1)

    yield* TestClock.adjust(HERDR_RECONNECT_BASE)
    yield* Queue.take(subscriptions)
    yield* answerRead(restartedWithoutAgents)
    const restarted = yield* stateAt(sync, 2)

    expect(lost.herdr.connection).toBe(initial.herdr.connection)
    expect(lost.herdr.lostAt).toEqual(
      Option.some(
        DateTime.makeUnsafe(Duration.toMillis(Duration.sum(RECONNECT_CAP, HERDR_RECONNECT_BASE))),
      ),
    )
    expect(lost.agents).toEqual(initial.agents)
    expect(isHerdrLost(restarted)).toBe(false)
    expect(isResync(lost, restarted)).toBe(true)
    expect(restarted.agents).toEqual([])
    expect(panePresence(restarted, PaneId.make('w1:p1'))).toBe('noAgent')
  }),
)

it.effect('keeps backing off while herdr drops every connection before the reconnect cap', () =>
  Effect.gen(function* () {
    const { sync, subscriptions, answerRead } = yield* startSync(working)
    const first = yield* Queue.take(subscriptions)

    yield* answerRead(working)
    yield* Queue.fail(first.events, new HerdrConnectionClosed({ method: 'events.subscribe' }))
    const firstLost = yield* stateAt(sync, 1)

    yield* TestClock.adjust(HERDR_RECONNECT_BASE)
    const second = yield* Queue.take(subscriptions)

    yield* answerRead(working)
    const reconnected = yield* stateAt(sync, 2)

    yield* Queue.fail(second.events, new HerdrConnectionClosed({ method: 'events.subscribe' }))
    const secondLost = yield* stateAt(sync, 3)

    yield* TestClock.adjust(
      Duration.subtract(Duration.times(HERDR_RECONNECT_BASE, 2), Duration.millis(1)),
    )
    const early = yield* Queue.size(subscriptions)

    yield* TestClock.adjust(1)

    expect(isHerdrLost(firstLost)).toBe(true)
    expect(isHerdrLost(reconnected)).toBe(false)
    expect(isHerdrLost(secondLost)).toBe(true)
    expect(early).toBe(0)
    expect(yield* Queue.size(subscriptions)).toBe(1)
  }),
)

it.effect('drops a tab that vanished with only the pane_exited of its last pane', () =>
  Effect.gen(function* () {
    const twoTabs = sessionSnapshot(
      [agentInfo()],
      [paneInfo(), paneInfo({ pane_id: 'w1:p7', terminal_id: 'term_7', tab_id: 'w1:t4' })],
      [tabInfo, exitTestTab],
    )
    const { sync, subscriptions, answerRead } = yield* startSync(twoTabs)
    const subscription = yield* Queue.take(subscriptions)

    yield* answerRead(twoTabs)
    yield* Queue.offer(subscription.events, lastPaneExited)
    yield* answerRead(working)
    const state = yield* stateAt(sync, 1)

    expect(state.tabs.map((tab) => tab.id)).toEqual(['w1:t1'])
    expect(panePresence(state, PaneId.make('w1:p7'))).toBe('gone')
  }),
)

it.effect(
  'shows each read to the recent places and publishes their answer in the same version',
  () =>
    Effect.gen(function* () {
      const observed = yield* Queue.unbounded<{
        readonly agents: readonly AgentRow[]
        readonly firstSightAt: DateTime.Utc
      }>()
      const place = new Place({
        folder: '/home/jliocsar/Projects/crook',
        checkout: Option.some(new Checkout({ branch: Option.some(BRANCH) })),
        usedAt: DateTime.makeUnsafe('2026-10-21T13:27:00Z'),
      })
      const recentPlaces = Layer.succeed(
        RecentPlaces,
        RecentPlaces.of({
          observe: (agents, firstSightAt) =>
            Effect.as(Queue.offer(observed, { agents, firstSightAt }), [place]),
        }),
      )
      const { sync } = yield* startSync(working, [], new Map(), recentPlaces)
      const seen = yield* Queue.take(observed)
      const published = yield* stateAt(sync, 0)

      expect(seen.agents.map((row) => row.pane)).toEqual(['w1:p1'])
      expect(seen.agents.map((row) => row.statusChangedAt)).toEqual([seen.firstSightAt])
      expect(published.places).toEqual([place])
    }),
)
