import * as Arr from 'effect/Array'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as FiberMap from 'effect/FiberMap'
import { pipe } from 'effect/Function'
import * as HashMap from 'effect/HashMap'
import * as HashSet from 'effect/HashSet'
import * as Layer from 'effect/Layer'
import * as Stream from 'effect/Stream'
import * as SubscriptionRef from 'effect/SubscriptionRef'

import { SubagentRoster } from '@crook/claude/SubagentRoster'
import { TranscriptLocator } from '@crook/claude/TranscriptLocator'
import type { ClaudeSessionId } from '@crook/domain/Ids'
import type { Subagent } from '@crook/domain/Subagent'

export type RunningCounts = HashMap.HashMap<ClaudeSessionId, number>

export const NO_RUNNING_COUNTS: RunningCounts = HashMap.empty()

export const runningCount = (roster: readonly Subagent[]): number =>
  Arr.filter(roster, (subagent) => subagent.status === 'running').length

const make = Effect.gen(function* () {
  const locator = yield* TranscriptLocator
  const roster = yield* SubagentRoster
  const counts = yield* SubscriptionRef.make(NO_RUNNING_COUNTS)
  const watching = yield* FiberMap.make<ClaudeSessionId>()

  const countsOf = (session: ClaudeSessionId) =>
    Stream.unwrap(Effect.map(locator.await(session), roster.watch)).pipe(
      Stream.map(runningCount),
      Stream.changes,
    )

  const watchSession = Effect.fn('RunningSubagents.watchSession')(function* (
    session: ClaudeSessionId,
  ) {
    yield* countsOf(session).pipe(
      Stream.runForEach((count) => SubscriptionRef.update(counts, HashMap.set(session, count))),
      Effect.catch((error) =>
        Effect.logWarning(
          `Stopped counting the running subagents of a Claude session, so its card shows none until the pane starts another session: ${error.message}`,
        ),
      ),
      Effect.ensuring(SubscriptionRef.update(counts, HashMap.remove(session))),
      Effect.annotateLogs('claudeSession', session),
    )
  })

  const follow = Effect.fn('RunningSubagents.follow')(function* (
    sessions: HashSet.HashSet<ClaudeSessionId>,
  ) {
    const stale = pipe(
      Arr.fromIterable(watching),
      Arr.map(([session]) => session),
      Arr.filter((session) => !HashSet.has(sessions, session)),
    )

    yield* Effect.forEach(stale, (session) => FiberMap.remove(watching, session), {
      discard: true,
    })
    yield* Effect.forEach(
      sessions,
      (session) => FiberMap.run(watching, session, watchSession(session), { onlyIfMissing: true }),
      { discard: true },
    )
  })

  return RunningSubagents.fromRef(counts, follow)
})

export class RunningSubagents extends Context.Service<
  RunningSubagents,
  {
    readonly current: Effect.Effect<RunningCounts>
    readonly changes: Stream.Stream<RunningCounts>
    readonly follow: (sessions: HashSet.HashSet<ClaudeSessionId>) => Effect.Effect<void>
  }
>()('@crook/agent/RunningSubagents') {
  static readonly layerWithoutDependencies = Layer.effect(this, make)

  static readonly layerAt = (roots: readonly string[]) =>
    this.layerWithoutDependencies.pipe(
      Layer.provide([TranscriptLocator.layerAt(roots), SubagentRoster.layer]),
    )

  static readonly layer = this.layerWithoutDependencies.pipe(
    Layer.provide([TranscriptLocator.layer, SubagentRoster.layer]),
  )

  static readonly fromRef = (
    counts: SubscriptionRef.SubscriptionRef<RunningCounts>,
    follow: (sessions: HashSet.HashSet<ClaudeSessionId>) => Effect.Effect<void>,
  ) =>
    RunningSubagents.of({
      current: SubscriptionRef.get(counts),
      changes: SubscriptionRef.changes(counts),
      follow,
    })

  static readonly layerTest = (
    counts: SubscriptionRef.SubscriptionRef<RunningCounts>,
    follow: (sessions: HashSet.HashSet<ClaudeSessionId>) => Effect.Effect<void> = () => Effect.void,
  ) => Layer.succeed(this, this.fromRef(counts, follow))
}
