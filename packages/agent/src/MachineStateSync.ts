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
import * as Schedule from 'effect/Schedule'
import * as Stream from 'effect/Stream'
import * as SubscriptionRef from 'effect/SubscriptionRef'

import { ClaudeSessions } from '@crook/agent/ClaudeSessions'
import { CreatedPanes } from '@crook/agent/CreatedPanes'
import { GitBranches } from '@crook/agent/GitBranches'
import {
  type HerdReading,
  type ResolvedAgent,
  initialMachineState,
  nextMachineState,
  withCreatedPanes,
  workingDirectoryOf,
} from '@crook/agent/MachineStateMapping'
import { MachineId } from '@crook/domain/Ids'
import type { MachineState } from '@crook/domain/MachineState'
import type { LifecycleEventKind, Subscription } from '@crook/herdr/Events'
import { HerdrClient, type HerdrSubscriptionError } from '@crook/herdr/HerdrClient'
import type { AgentInfo } from '@crook/herdr/Records'

const HERDR_RECONNECT_INTERVAL = Duration.millis(100)

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
  'pane.created',
  'pane.closed',
  'pane.updated',
  'pane.moved',
  'pane.exited',
  'pane.agent_detected',
]

export const CrookMachineId = Config.schema(MachineId, 'CROOK_MACHINE_ID')

const agentPanes = (state: MachineState) =>
  HashSet.fromIterable(state.agents.map((row) => row.pane))

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

const make = Effect.gen(function* () {
  const herdr = yield* HerdrClient
  const claudeSessions = yield* ClaudeSessions
  const gitBranches = yield* GitBranches
  const createdPanes = yield* CreatedPanes
  const machine = yield* CrookMachineId

  const sessionOf = (info: AgentInfo) =>
    claudeSessions.resolve(info).pipe(
      Effect.catchTags({
        ClaudeSessionFileUnreadable: (error) =>
          Effect.as(Effect.logWarning(error.message), Option.none()),
        HerdrRequestRejected: (error) => Effect.as(Effect.logWarning(error.message), Option.none()),
        HerdrAgentNotFound: (error) => Effect.as(Effect.logWarning(error.message), Option.none()),
        HerdrResponseInvalid: (error) => Effect.as(Effect.logWarning(error.message), Option.none()),
      }),
    )

  const branchOf = (info: AgentInfo) =>
    Option.match(workingDirectoryOf(info), {
      onNone: () => Effect.succeedNone,
      onSome: (cwd) =>
        gitBranches
          .branchOf(cwd)
          .pipe(
            Effect.catchTag('GitMetadataUnreadable', (error) =>
              Effect.as(Effect.logWarning(error.message), Option.none<string>()),
            ),
          ),
    })

  const resolveAgent = (info: AgentInfo) =>
    Effect.zipWith(
      sessionOf(info),
      branchOf(info),
      (claudeSession, branch): ResolvedAgent => ({ info, claudeSession, branch }),
      { concurrent: true },
    ).pipe(Effect.annotateLogs('pane', info.pane_id))

  const read = Effect.fn('MachineStateSync.read')(function* () {
    const snapshot = yield* herdr.snapshot
    const agents = yield* Effect.forEach(snapshot.agents, resolveAgent, {
      concurrency: 'unbounded',
    })
    const reading: HerdReading = {
      herdrVersion: snapshot.version,
      workspaces: snapshot.workspaces,
      tabs: snapshot.tabs,
      panes: snapshot.panes,
      agents,
      createdPanes: yield* createdPanes.current,
    }

    return { reading, now: yield* DateTime.now }
  })

  const initial = yield* read().pipe(
    Effect.map(({ reading, now }) => initialMachineState(machine, reading, now)),
    Effect.tapError(logHerdrFailure),
    Effect.retry(Schedule.spaced(HERDR_RECONNECT_INTERVAL)),
  )
  const state = yield* SubscriptionRef.make(initial)

  const refresh = SubscriptionRef.updateSomeAndGetEffect(state, (previous) =>
    Effect.map(read(), ({ reading, now }) => nextMachineState(previous, reading, now)),
  )

  const follow = Effect.fn('MachineStateSync.follow')(function* () {
    const subscribed = agentPanes(yield* SubscriptionRef.get(state))
    const events = yield* herdr.subscribe(subscriptionsFor(subscribed))

    yield* Stream.concat(Stream.succeed(undefined), events).pipe(
      Stream.buffer({ capacity: 1, strategy: 'sliding' }),
      Stream.mapEffect(() => refresh),
      Stream.takeUntil((next) => !Equal.equals(agentPanes(next), subscribed)),
      Stream.runDrain,
    )
  }, Effect.scoped)

  yield* follow().pipe(
    Effect.catchTags({
      HerdrEventsLost: (error) => Effect.logDebug(error.message),
      HerdrPaneNotFound: (error) => Effect.andThen(Effect.logDebug(error.message), refresh),
    }),
    Effect.tapError(logHerdrFailure),
    Effect.retry(Schedule.spaced(HERDR_RECONNECT_INTERVAL)),
    Effect.forever,
    Effect.forkScoped,
  )

  yield* createdPanes.changes.pipe(
    Stream.runForEach((created) =>
      SubscriptionRef.updateSome(state, (previous) => withCreatedPanes(previous, created)),
    ),
    Effect.forkScoped,
  )

  const scope = yield* Effect.scope
  const invalidate = refresh.pipe(
    Effect.tapError(logHerdrFailure),
    Effect.ignore,
    Effect.forkIn(scope),
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
