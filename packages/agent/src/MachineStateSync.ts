import type * as NonEmptyArray from 'effect/Array'
import * as Arr from 'effect/Array'
import * as Config from 'effect/Config'
import * as Context from 'effect/Context'
import * as DateTime from 'effect/DateTime'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Equal from 'effect/Equal'
import { pipe } from 'effect/Function'
import * as HashSet from 'effect/HashSet'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Queue from 'effect/Queue'
import * as Random from 'effect/Random'
import * as Ref from 'effect/Ref'
import * as Stream from 'effect/Stream'
import * as SubscriptionRef from 'effect/SubscriptionRef'

import { CheckoutHeads } from '@crook/agent/CheckoutHeads'
import { ClaudeSessionFiles } from '@crook/agent/ClaudeSessionFiles'
import { ClaudeSessions } from '@crook/agent/ClaudeSessions'
import { CreatedPanes } from '@crook/agent/CreatedPanes'
import { GitBranches } from '@crook/agent/GitBranches'
import {
  type HerdReading,
  type MachineStateContents,
  type ResolvedAgent,
  herdContents,
  herdrLostState,
  initialMachineState,
  machineStateWithHerdrLost,
  nextMachineState,
  withCreatedPanes,
  withRunningSubagents,
  workingDirectoryOf,
} from '@crook/agent/MachineStateMapping'
import { PendingAsks } from '@crook/agent/PendingAsks'
import { RecentPlaces } from '@crook/agent/RecentPlaces'
import { trackConnectionHealth } from '@crook/agent/Reconnect'
import { RunningSubagents } from '@crook/agent/RunningSubagents'
import type { AgentRow } from '@crook/domain/AgentRow'
import { HerdrConnectionId, MachineId } from '@crook/domain/Ids'
import { type MachineState, isHerdrLost } from '@crook/domain/MachineState'
import type { LifecycleEventKind, Subscription } from '@crook/herdr/Events'
import {
  HerdrClient,
  type HerdrSubscriptionError,
  type HerdrTimedOut,
} from '@crook/herdr/HerdrClient'
import type { AgentInfo } from '@crook/herdr/Records'
import { reconnectBackoff } from '@crook/protocol/LinkTiming'

const STATE_EVENT_KINDS: NonEmptyArray.NonEmptyReadonlyArray<LifecycleEventKind> = [
  'workspace.created',
  'workspace.updated',
  'workspace.renamed',
  'workspace.moved',
  'workspace.reordered',
  'workspace.closed',
  'tab.created',
  'tab.closed',
  'tab.renamed',
  'tab.moved',
  'tab.focused',
  'pane.created',
  'pane.closed',
  'pane.updated',
  'pane.moved',
  'pane.exited',
  'pane.agent_detected',
]

export const HERDR_RECONNECT_BASE = Duration.millis(100)

export const CrookMachineId = Config.schema(MachineId, 'CROOK_MACHINE_ID')

const herdrBackoff = reconnectBackoff(HERDR_RECONNECT_BASE)

const mintConnection = Effect.map(Random.nextInt, (value) => HerdrConnectionId.make(value))

const agentPanes = (state: MachineState) =>
  HashSet.fromIterable(state.agents.map((row) => row.pane))

const claudeSessionsOf = (state: MachineState) =>
  HashSet.fromIterable(Arr.flatMap(state.agents, (row) => Option.toArray(row.claudeSession)))

const followedFoldersOf = (state: MachineState) =>
  HashSet.fromIterable(Arr.map(state.agents, (row) => ({ cwd: row.cwd, branch: row.branch })))

const followCheckouts = (
  state: SubscriptionRef.SubscriptionRef<MachineState>,
  checkoutHeads: CheckoutHeads['Service'],
) =>
  SubscriptionRef.changes(state).pipe(
    Stream.map(followedFoldersOf),
    Stream.changes,
    Stream.map(HashSet.map((folder) => folder.cwd)),
    Stream.runForEach(checkoutHeads.follow),
  )

const STATE_SUBSCRIPTIONS = Arr.map(STATE_EVENT_KINDS, (type): Subscription => ({ type }))

const subscriptionsFor = (panes: HashSet.HashSet<string>) =>
  pipe(
    Arr.fromIterable(panes),
    Arr.map((pane_id): Subscription => ({ type: 'pane.agent_status_changed', pane_id })),
    Arr.prependAll(STATE_SUBSCRIPTIONS),
  )

const logHerdrFailure = (error: HerdrSubscriptionError) =>
  Match.value(error).pipe(
    Match.tag('HerdrUnreachable', (unreachable) => Effect.logDebug(unreachable.message)),
    Match.orElse((failure) => Effect.logWarning(failure.message)),
  )

const sessionOf = (claudeSessions: ClaudeSessions['Service'], info: AgentInfo) =>
  claudeSessions.resolve(info).pipe(
    Effect.catchTags({
      ClaudeSessionFileUnreadable: (error) =>
        Effect.as(Effect.logWarning(error.message), Option.none()),
      HerdrRequestRejected: (error) => Effect.as(Effect.logWarning(error.message), Option.none()),
      HerdrAgentNotFound: (error) => Effect.as(Effect.logWarning(error.message), Option.none()),
      HerdrResponseInvalid: (error) => Effect.as(Effect.logWarning(error.message), Option.none()),
    }),
  )

const make = Effect.gen(function* () {
  const herdr = yield* HerdrClient
  const claudeSessions = yield* ClaudeSessions
  const sessionFiles = yield* ClaudeSessionFiles
  const gitBranches = yield* GitBranches
  const checkoutHeads = yield* CheckoutHeads
  const createdPanes = yield* CreatedPanes
  const asks = yield* PendingAsks
  const recentPlaces = yield* RecentPlaces
  const runningSubagents = yield* RunningSubagents
  const machine = yield* CrookMachineId

  const branchOf = (info: AgentInfo) =>
    Option.match(workingDirectoryOf(info), {
      onNone: () => Effect.succeedNone,
      onSome: (cwd) =>
        gitBranches.checkoutOf(cwd).pipe(
          Effect.map(Option.flatMap((checkout) => checkout.branch)),
          Effect.catchTag('GitMetadataUnreadable', (error) =>
            Effect.as(Effect.logWarning(error.message), Option.none<string>()),
          ),
        ),
    })

  const claudeFactsOf = (info: AgentInfo, mark: number) =>
    Effect.flatMap(sessionOf(claudeSessions, info), (claudeSession) =>
      Effect.zipWith(
        asks.askOf(info, claudeSession, mark),
        Option.match(claudeSession, {
          onNone: () => Effect.succeedNone,
          onSome: sessionFiles.waiting,
        }),
        (ask, claudeWaiting) => ({ claudeSession, ask, claudeWaiting }),
      ),
    )

  const resolveAgent = (mark: number) => (info: AgentInfo) =>
    Effect.zipWith(
      claudeFactsOf(info, mark),
      branchOf(info),
      (facts, branch): ResolvedAgent => ({ info, branch, ...facts }),
      { concurrent: true },
    ).pipe(Effect.annotateLogs('pane', info.pane_id))

  const read = Effect.fn('MachineStateSync.read')(function* () {
    const mark = yield* asks.mark
    const snapshot = yield* herdr.snapshot
    const agents = yield* Effect.forEach(snapshot.agents, resolveAgent(mark), {
      concurrency: 'unbounded',
    })

    yield* asks.retain(
      Arr.flatMap(agents, (agent) => Option.toArray(agent.claudeSession)),
      mark,
    )

    return {
      herdrVersion: snapshot.version,
      workspaces: snapshot.workspaces,
      tabs: snapshot.tabs,
      panes: snapshot.panes,
      agents,
      createdPanes: yield* createdPanes.current,
      runningSubagents: yield* runningSubagents.current,
    } satisfies HerdReading
  })

  const contentsOf = Effect.fn('MachineStateSync.contentsOf')(function* (
    previousAgents: readonly AgentRow[],
    connection: HerdrConnectionId,
    reading: HerdReading,
    observedAt: DateTime.Utc,
    placesSince: DateTime.Utc,
  ) {
    const contents = herdContents(previousAgents, connection, reading, observedAt)
    const places = yield* recentPlaces.observe(contents.agents, placesSince)

    return { ...contents, places } satisfies MachineStateContents
  })

  const firstConnection = yield* mintConnection
  const startedAt = yield* DateTime.now

  const readInitial = Effect.fn('MachineStateSync.readInitial')(function* () {
    const reading = yield* read()
    const contents = yield* contentsOf([], firstConnection, reading, startedAt, startedAt)

    return initialMachineState(machine, contents)
  })

  const startWithHerdrLost = Effect.fn('MachineStateSync.startWithHerdrLost')(function* (
    error: HerdrSubscriptionError,
  ) {
    yield* Effect.logWarning(error.message)

    const places = yield* recentPlaces.observe([], startedAt)

    return machineStateWithHerdrLost(machine, firstConnection, places, startedAt)
  })

  const initial = yield* readInitial().pipe(Effect.catch(startWithHerdrLost))
  const state = yield* SubscriptionRef.make(initial)
  const resyncPending = yield* Ref.make(isHerdrLost(initial))
  const suspectedHangs = yield* Queue.sliding<void>(1)

  const connectionAfter = (previous: MachineState) =>
    Effect.flatMap(Ref.getAndSet(resyncPending, false), (pending) =>
      pending ? mintConnection : Effect.succeed(previous.herdr.connection),
    )

  const refresh = SubscriptionRef.updateSomeAndGetEffect(state, (previous) =>
    Effect.gen(function* () {
      const reading = yield* read()
      const connection = yield* connectionAfter(previous)
      const contents = yield* contentsOf(
        previous.agents,
        connection,
        reading,
        yield* DateTime.now,
        startedAt,
      )

      return nextMachineState(previous, contents)
    }),
  )

  const markHerdrLost = Effect.flatMap(DateTime.now, (now) =>
    SubscriptionRef.updateSome(state, (previous) => herdrLostState(previous, now)),
  )

  const follow = Effect.fn('MachineStateSync.follow')(function* (markHealthy: Effect.Effect<void>) {
    const subscribed = agentPanes(yield* SubscriptionRef.get(state))

    yield* herdr.subscribe(subscriptionsFor(subscribed)).pipe(
      Effect.flatMap((events) =>
        Stream.concat(
          Stream.succeed(undefined),
          events.pipe(
            Stream.merge(Stream.fromQueue(suspectedHangs)),
            Stream.merge(sessionFiles.changes),
            Stream.merge(checkoutHeads.changes),
          ),
        ).pipe(
          Stream.buffer({ capacity: 1, strategy: 'sliding' }),
          Stream.mapEffect(() => refresh),
          Stream.tap(() => markHealthy),
          Stream.takeUntil((next) => !Equal.equals(agentPanes(next), subscribed)),
          Stream.runDrain,
        ),
      ),
      Effect.catchTag('HerdrPaneNotFound', (error) =>
        Effect.logDebug(error.message).pipe(
          Effect.andThen(refresh),
          Effect.flatMap((next) =>
            Equal.equals(agentPanes(next), subscribed) ? Effect.fail(error) : Effect.void,
          ),
        ),
      ),
    )
  }, Effect.scoped)

  const herdrSession = Effect.fn('MachineStateSync.herdrSession')(function* () {
    const health = yield* trackConnectionHealth

    yield* follow(health.markHealthy).pipe(
      Effect.forever,
      Effect.catch((error) =>
        logHerdrFailure(error).pipe(
          Effect.andThen(Ref.set(resyncPending, true)),
          Effect.andThen(health.stayedHealthy),
          Effect.flatMap((healthy) =>
            healthy
              ? Effect.sleep(HERDR_RECONNECT_BASE)
              : Effect.andThen(markHerdrLost, Effect.fail(error)),
          ),
        ),
      ),
    )
  })

  yield* herdrSession().pipe(Effect.retry(herdrBackoff), Effect.forever, Effect.forkScoped)

  yield* createdPanes.changes.pipe(
    Stream.runForEach((created) =>
      SubscriptionRef.updateSome(state, (previous) => withCreatedPanes(previous, created)),
    ),
    Effect.forkScoped,
  )

  yield* SubscriptionRef.changes(state).pipe(
    Stream.map(claudeSessionsOf),
    Stream.changes,
    Stream.runForEach(runningSubagents.follow),
    Effect.forkScoped,
  )

  yield* Effect.forkScoped(followCheckouts(state, checkoutHeads))

  yield* runningSubagents.changes.pipe(
    Stream.runForEach((counts) =>
      SubscriptionRef.updateSome(state, (previous) => withRunningSubagents(previous, counts)),
    ),
    Effect.forkScoped,
  )

  const scope = yield* Effect.scope
  const noteHang = (timedOut: HerdrTimedOut) =>
    Effect.logWarning(timedOut.message).pipe(
      Effect.andThen(Ref.set(resyncPending, true)),
      Effect.andThen(markHerdrLost),
      Effect.andThen(Queue.offer(suspectedHangs, undefined)),
    )
  const invalidate = refresh.pipe(
    Effect.catch((error: HerdrSubscriptionError) =>
      Match.value(error).pipe(Match.tag('HerdrTimedOut', noteHang), Match.orElse(logHerdrFailure)),
    ),
    Effect.forkIn(scope),
  )

  yield* asks.changes.pipe(
    Stream.runForEach(() => invalidate),
    Effect.forkScoped,
  )

  return MachineStateSync.fromRef(state, invalidate)
})

export class MachineStateSync extends Context.Service<
  MachineStateSync,
  {
    readonly current: Effect.Effect<MachineState>
    readonly changes: Stream.Stream<MachineState>
    readonly invalidate: Effect.Effect<void>
  }
>()('@crook/agent/MachineStateSync') {
  static readonly layer = Layer.effect(this, make)

  static readonly fromRef = (
    state: SubscriptionRef.SubscriptionRef<MachineState>,
    invalidate: Effect.Effect<void>,
  ) =>
    MachineStateSync.of({
      current: SubscriptionRef.get(state),
      changes: SubscriptionRef.changes(state),
      invalidate,
    })

  static readonly layerTest = (
    state: SubscriptionRef.SubscriptionRef<MachineState>,
    invalidate: Effect.Effect<void> = Effect.void,
  ) => Layer.succeed(this, this.fromRef(state, invalidate))
}
