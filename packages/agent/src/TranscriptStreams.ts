import * as Arr from 'effect/Array'
import type { NonEmptyReadonlyArray } from 'effect/Array'
import * as Cause from 'effect/Cause'
import * as Clock from 'effect/Clock'
import * as Context from 'effect/Context'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Equivalence from 'effect/Equivalence'
import * as FiberMap from 'effect/FiberMap'
import { pipe } from 'effect/Function'
import * as HashMap from 'effect/HashMap'
import * as HashSet from 'effect/HashSet'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Ref from 'effect/Ref'
import * as Schedule from 'effect/Schedule'
import * as Schema from 'effect/Schema'
import * as Stream from 'effect/Stream'
import * as Struct from 'effect/Struct'
import type { RpcClientError } from 'effect/rpc/RpcClientError'

import { MachineStateSync } from '@crook/agent/MachineStateSync'
import { type OpenTasks, TaskLiveness } from '@crook/agent/TaskLiveness'
import { type BackgroundSnapshot, BackgroundWork, sameSnapshot } from '@crook/claude/BackgroundWork'
import { SkillCatalog } from '@crook/claude/SkillCatalog'
import { SubagentRoster, type SubagentsUnreadable } from '@crook/claude/SubagentRoster'
import {
  type LocateError,
  type TranscriptFile,
  TranscriptLocator,
} from '@crook/claude/TranscriptLocator'
import { type TailError, TranscriptTail } from '@crook/claude/TranscriptTail'
import type { ClaudeSessionId, PaneId, SubagentId, TranscriptOffset } from '@crook/domain/Ids'
import { type BackgroundTask, ShellTask } from '@crook/domain/Background'
import type { Subagent } from '@crook/domain/Subagent'
import {
  BackgroundChanged,
  SkillsChanged,
  SubagentsChanged,
  TRANSCRIPT_START,
  TranscriptCaughtUp,
  type TranscriptEvent,
  TranscriptOpened,
  type TranscriptPosition,
  type TranscriptSource,
  type TranscriptTailBytes,
  omittedBetween,
  positionAfter,
} from '@crook/domain/Transcript'
import {
  type TranscriptDemand,
  type TranscriptFailure,
  TranscriptReadFailed,
  TranscriptResumeRejected,
  TranscriptSessionRejected,
  type TranscriptOutOfStep,
  type TranscriptUpdate,
  type TranscriptWatch,
  TranscriptWatchFailed,
  type TranscriptWatchId,
  isWatchFailed,
} from '@crook/protocol/Transcripts'
import { makeTranscriptMailbox } from '@crook/protocol/TranscriptBatch'

export type FollowError = LocateError | TailError | SubagentsUnreadable

type FirstMisses = HashMap.HashMap<string, number>

interface LiveSources {
  readonly tail: TranscriptTail['Service']
  readonly roster: SubagentRoster['Service']
  readonly background: BackgroundWork['Service']
  readonly liveness: TaskLiveness['Service']
}

interface PaneSession {
  readonly session: ClaudeSessionId
  readonly cwd: string
}

export interface TranscriptLink {
  readonly demands: Stream.Stream<TranscriptDemand, RpcClientError>
  readonly publish: (
    watch: TranscriptWatchId,
    updates: NonEmptyReadonlyArray<TranscriptUpdate>,
  ) => Effect.Effect<void, TranscriptOutOfStep | RpcClientError>
}

export class TranscriptDemandsEnded extends Schema.TaggedError<TranscriptDemandsEnded>()(
  'TranscriptDemandsEnded',
  {},
) {
  override get message(): string {
    return 'The hub ended the stream of transcripts it wants from this machine, so open chats would stop updating. crook reconnects on its own; if this keeps happening, check the hub logs.'
  }
}

const LIVENESS_RECHECK = Duration.seconds(5)

const sameSession = Option.makeEquivalence(
  Equivalence.mapInput(
    Equivalence.strictEqual<ClaudeSessionId>(),
    (paneSession: PaneSession) => paneSession.session,
  ),
)

const toWireFailure = (error: FollowError): TranscriptFailure =>
  Match.value(error).pipe(
    Match.tagsExhaustive({
      TranscriptSessionInvalid: (invalid) =>
        new TranscriptSessionRejected({ session: invalid.session }),
      TranscriptDirectoryUnreadable: (unreadable) =>
        new TranscriptReadFailed({ detail: unreadable.message }),
      TranscriptUnreadable: (unreadable) =>
        new TranscriptReadFailed({ detail: unreadable.message }),
      SubagentsUnreadable: (unreadable) => new TranscriptReadFailed({ detail: unreadable.message }),
      TranscriptOffsetBeyondEnd: (rejected) =>
        new TranscriptResumeRejected({ detail: rejected.message }),
      TranscriptOffsetMidLine: (rejected) =>
        new TranscriptResumeRejected({ detail: rejected.message }),
      TranscriptShrank: (rejected) => new TranscriptResumeRejected({ detail: rejected.message }),
    }),
  )

const failedWith = (failure: TranscriptFailure, log: Effect.Effect<void>) =>
  Stream.concat(
    Stream.fromEffectDrain(log),
    Stream.succeed<TranscriptUpdate>(new TranscriptWatchFailed({ failure })),
  )

const FOLLOW_ENDED: TranscriptUpdate = new TranscriptWatchFailed({
  failure: new TranscriptReadFailed({
    detail: 'the agent stopped following the file on its own. Open the chat again to resume it.',
  }),
})

const followFailed = (error: FollowError) =>
  failedWith(toWireFailure(error), Effect.logWarning(error.message))

const stoppedByDefect = (defect: Cause.Cause<never>) =>
  new TranscriptReadFailed({
    detail: `a bug in the crook agent stopped the watch: ${Cause.pretty(defect)}`,
  })

const followDefected = (defect: Cause.Cause<never>) =>
  failedWith(
    stoppedByDefect(defect),
    Effect.logError('A transcript watch died of a defect; the phone is told it failed.', defect),
  )

const startIn = (session: ClaudeSessionId, from: Option.Option<TranscriptPosition>) =>
  pipe(
    from,
    Option.filter((position) => position.session === session),
    Option.match({ onNone: () => TRANSCRIPT_START, onSome: (position) => position.offset }),
  )

const rosterOf =
  (session: ClaudeSessionId) =>
  (subagents: readonly Subagent[]): TranscriptEvent =>
    new SubagentsChanged({ session, subagents })

const backgroundOf =
  (session: ClaudeSessionId) =>
  (snapshot: BackgroundSnapshot): TranscriptEvent =>
    new BackgroundChanged({ session, tasks: snapshot.tasks, activity: snapshot.activity })

const hasBackgroundWork = (snapshot: BackgroundSnapshot) =>
  snapshot.tasks.length > 0 || snapshot.activity.length > 0

const hasRunningShell = (snapshot: BackgroundSnapshot): boolean =>
  Arr.some(snapshot.tasks, (task) =>
    Match.value(task).pipe(
      Match.tag('ShellTask', (shell) => shell.status === 'running'),
      Match.orElse(() => false),
    ),
  )

const missedShells = (snapshot: BackgroundSnapshot, open: OpenTasks): HashSet.HashSet<string> =>
  Option.match(open, {
    onNone: () => HashSet.empty<string>(),
    onSome: (tasks) =>
      HashSet.fromIterable(
        Arr.flatMap(snapshot.tasks, (task) =>
          Match.value(task).pipe(
            Match.tag('ShellTask', (shell) =>
              shell.status === 'running' && !HashSet.has(tasks, shell.taskId) ? [shell.taskId] : [],
            ),
            Match.orElse(() => []),
          ),
        ),
      ),
  })

const missesAfter = (
  before: FirstMisses,
  snapshot: BackgroundSnapshot,
  open: OpenTasks,
  checkedAt: number,
): FirstMisses =>
  HashMap.fromIterable(
    pipe(
      missedShells(snapshot, open),
      Arr.fromIterable,
      Arr.map((taskId) => [taskId, Option.getOrElse(HashMap.get(before, taskId), () => checkedAt)]),
    ),
  )

const aliveAfter = (
  open: OpenTasks,
  misses: FirstMisses,
  checkedAt: number,
  taskId: string,
): Option.Option<boolean> =>
  Option.map(
    open,
    () =>
      !Option.exists(
        HashMap.get(misses, taskId),
        (firstMissedAt) => checkedAt - firstMissedAt >= Duration.toMillis(LIVENESS_RECHECK),
      ),
  )

const withLiveness = (
  snapshot: BackgroundSnapshot,
  open: OpenTasks,
  misses: FirstMisses,
  checkedAt: number,
): BackgroundSnapshot => ({
  ...snapshot,
  tasks: Arr.map(snapshot.tasks, (task) =>
    Match.value(task).pipe(
      Match.tag('ShellTask', (shell): BackgroundTask =>
        shell.status === 'running'
          ? new ShellTask(
              Struct.evolve(shell, {
                alive: () => aliveAfter(open, misses, checkedAt, shell.taskId),
              }),
            )
          : shell,
      ),
      Match.orElse((): BackgroundTask => task),
    ),
  ),
})

const backgroundWork = (
  background: BackgroundWork['Service'],
  liveness: TaskLiveness['Service'],
  file: TranscriptFile,
) =>
  background.watch(file).pipe(
    Stream.switchMap((snapshot) =>
      hasRunningShell(snapshot)
        ? Stream.as(Stream.fromSchedule(Schedule.spaced(LIVENESS_RECHECK)), snapshot).pipe(
            Stream.prepend([snapshot]),
          )
        : Stream.succeed(snapshot),
    ),
    Stream.mapEffect((snapshot) =>
      Effect.zipWith(
        Clock.currentTimeMillis,
        hasRunningShell(snapshot) ? liveness.openTasks(file) : Effect.succeedNone,
        (checkedAt, open) => [snapshot, open, checkedAt] as const,
      ),
    ),
    Stream.mapAccum(
      (): FirstMisses => HashMap.empty(),
      (before, [snapshot, open, checkedAt]) => {
        const misses = missesAfter(before, snapshot, open, checkedAt)

        return [misses, [withLiveness(snapshot, open, misses, checkedAt)]] as const
      },
    ),
    Stream.changesWith(sameSnapshot),
    Stream.dropWhile((snapshot) => !hasBackgroundWork(snapshot)),
    Stream.map(backgroundOf(file.session)),
    Stream.tapError((error) =>
      Effect.logWarning(
        `Stopped following the background work of ${file.session}: ${error.message}`,
      ),
    ),
    Stream.ignore,
  )

const liveEvents = (sources: LiveSources, file: TranscriptFile, offset: TranscriptOffset) =>
  Stream.mergeAll(
    [
      sources.tail.follow(file, offset),
      Stream.map(sources.roster.watch(file), rosterOf(file.session)),
      backgroundWork(sources.background, sources.liveness, file),
    ],
    { concurrency: 'unbounded' },
  )

const opened = (session: ClaudeSessionId) =>
  Stream.succeed<TranscriptEvent>(new TranscriptOpened({ session }))

const skillsIn = (
  catalog: SkillCatalog['Service'],
  session: ClaudeSessionId,
  cwd: string,
  file: Option.Option<TranscriptFile>,
) =>
  Stream.fromEffect(
    Effect.map(
      catalog.list(cwd, file),
      (skills): TranscriptEvent => new SkillsChanged({ session, skills }),
    ),
  )

const publishAll = Effect.fn('TranscriptStreams.publishAll')(function* (
  link: TranscriptLink,
  watch: TranscriptWatchId,
  events: Stream.Stream<TranscriptEvent, FollowError>,
) {
  const outbox = yield* makeTranscriptMailbox

  yield* events.pipe(
    Stream.catch(followFailed),
    Stream.catchDefect((defect) => followDefected(Cause.die(defect))),
    Stream.concat(Stream.succeed(FOLLOW_ENDED)),
    Stream.runForEach(outbox.offer),
    Effect.forkScoped,
  )

  yield* outbox.takeCaughtUp.pipe(
    Effect.flatMap((taken) =>
      Effect.as(link.publish(watch, taken), Arr.some(taken, isWatchFailed)),
    ),
    Effect.repeat({ until: (ended) => ended }),
  )
}, Effect.scoped)

const make = Effect.gen(function* () {
  const sync = yield* MachineStateSync
  const locator = yield* TranscriptLocator
  const tail = yield* TranscriptTail
  const roster = yield* SubagentRoster
  const catalog = yield* SkillCatalog
  const background = yield* BackgroundWork
  const liveness = yield* TaskLiveness
  const sources: LiveSources = { tail, roster, background, liveness }

  const fromLineNearEnd = (
    file: TranscriptFile,
    offset: TranscriptOffset,
    tailBytes: Option.Option<TranscriptTailBytes>,
    read: (from: TranscriptOffset) => Stream.Stream<TranscriptEvent, FollowError>,
  ): Stream.Stream<TranscriptEvent, FollowError> =>
    Option.match(tailBytes, {
      onNone: () => read(offset),
      onSome: (bytes) =>
        Stream.unwrap(
          Effect.map(tail.tailStart(file, offset, bytes), (start) =>
            start === offset
              ? read(offset)
              : Stream.concat(
                  Stream.succeed<TranscriptEvent>(omittedBetween(file.session, offset, start)),
                  read(start),
                ),
          ),
        ),
    })

  const openSession = (
    { session, cwd }: PaneSession,
    offset: TranscriptOffset,
    tailBytes: Option.Option<TranscriptTailBytes>,
  ) => {
    const following = (file: TranscriptFile) =>
      fromLineNearEnd(file, offset, tailBytes, (from) => liveEvents(sources, file, from))

    return Stream.concat(
      opened(session),
      Stream.unwrap(
        Effect.map(locator.locate(session), (found) =>
          Stream.concat(
            skillsIn(catalog, session, cwd, found),
            Option.match(found, {
              onSome: following,
              onNone: () =>
                Stream.concat(
                  Stream.succeed<TranscriptEvent>(new TranscriptCaughtUp({ session, offset })),
                  Stream.unwrap(Effect.map(locator.await(session), following)),
                ),
            }),
          ),
        ),
      ),
    )
  }

  const sessionsOf = (pane: PaneId) =>
    sync.changes.pipe(
      Stream.map((state) =>
        pipe(
          Arr.findFirst(state.agents, (row) => row.pane === pane),
          Option.flatMap((row) =>
            Option.map(row.claudeSession, (session): PaneSession => ({ session, cwd: row.cwd })),
          ),
        ),
      ),
      Stream.changesWith(sameSession),
    )

  const followPane = (
    pane: PaneId,
    from: Option.Option<TranscriptPosition>,
    tailBytes: Option.Option<TranscriptTailBytes>,
  ) =>
    Stream.unwrap(
      Effect.map(Ref.make(from), (position) =>
        sessionsOf(pane).pipe(
          Stream.switchMap(
            Option.match({
              onNone: () => Stream.never,
              onSome: (paneSession) =>
                Stream.unwrap(
                  Effect.map(Ref.get(position), (at) =>
                    openSession(paneSession, startIn(paneSession.session, at), tailBytes),
                  ),
                ),
            }),
          ),
          Stream.tap((event) => Ref.update(position, (at) => positionAfter(at, event))),
        ),
      ),
    )

  const followSubagent = (
    session: ClaudeSessionId,
    subagent: SubagentId,
    from: Option.Option<TranscriptPosition>,
    tailBytes: Option.Option<TranscriptTailBytes>,
  ) =>
    Stream.concat(
      opened(session),
      Stream.unwrap(
        locator.await(session).pipe(
          Effect.flatMap((file) => locator.awaitSubagent(file, subagent)),
          Effect.map((file) =>
            fromLineNearEnd(file, startIn(session, from), tailBytes, (start) =>
              tail.follow(file, start),
            ),
          ),
        ),
      ),
    )

  const follow = (
    source: TranscriptSource,
    from: Option.Option<TranscriptPosition>,
    tailBytes: Option.Option<TranscriptTailBytes>,
  ): Stream.Stream<TranscriptEvent, FollowError> =>
    Match.value(source).pipe(
      Match.tagsExhaustive({
        PaneTranscript: ({ pane }) => followPane(pane, from, tailBytes),
        SubagentTranscript: ({ session, subagent }) =>
          followSubagent(session, subagent, from, tailBytes),
      }),
    )

  const runWatch = (link: TranscriptLink, watch: TranscriptWatch) => {
    const attempt = (
      from: Option.Option<TranscriptPosition>,
    ): Effect.Effect<void, RpcClientError> =>
      publishAll(link, watch.id, follow(watch.source, from, watch.tail)).pipe(
        Effect.catchTag('TranscriptOutOfStep', (outOfStep) =>
          Effect.andThen(Effect.logDebug(outOfStep.message), attempt(outOfStep.expected)),
        ),
      )

    const publishDefected = (defect: Cause.Cause<never>) =>
      Effect.logError(
        'Publishing a transcript watch died of a defect; the phone is told it failed.',
        defect,
      ).pipe(
        Effect.andThen(
          link.publish(watch.id, [new TranscriptWatchFailed({ failure: stoppedByDefect(defect) })]),
        ),
        Effect.catch((error) => Effect.logWarning(error.message)),
        Effect.catchDefect((again) =>
          Effect.logError('Telling the phone its transcript watch failed died too.', again),
        ),
      )

    return attempt(watch.from).pipe(
      Effect.catchTag('RpcClientError', (error) => Effect.logDebug(error.message)),
      Effect.catchDefect((defect) => publishDefected(Cause.die(defect))),
      Effect.annotateLogs('transcriptWatch', watch.id),
    )
  }

  const serve = Effect.fn('TranscriptStreams.serve')(function* (link: TranscriptLink) {
    const running = yield* FiberMap.make<TranscriptWatchId>()

    const reconcile = (demand: TranscriptDemand) => {
      const wanted = HashSet.fromIterable(Arr.map(demand.watches, (watch) => watch.id))
      const stale = pipe(
        Arr.fromIterable(running),
        Arr.map(([id]) => id),
        Arr.filter((id) => !HashSet.has(wanted, id)),
      )

      return Effect.andThen(
        Effect.forEach(stale, (id) => FiberMap.remove(running, id), { discard: true }),
        Effect.forEach(
          demand.watches,
          (watch) =>
            FiberMap.run(running, watch.id, runWatch(link, watch), { onlyIfMissing: true }),
          { discard: true },
        ),
      )
    }

    yield* link.demands.pipe(Stream.runForEach(reconcile))

    return yield* new TranscriptDemandsEnded()
  }, Effect.scoped)

  return TranscriptStreams.of({ follow, serve })
})

export class TranscriptStreams extends Context.Service<
  TranscriptStreams,
  {
    readonly follow: (
      source: TranscriptSource,
      from: Option.Option<TranscriptPosition>,
      tailBytes: Option.Option<TranscriptTailBytes>,
    ) => Stream.Stream<TranscriptEvent, FollowError>
    readonly serve: (
      link: TranscriptLink,
    ) => Effect.Effect<never, TranscriptDemandsEnded | RpcClientError>
  }
>()('@crook/agent/TranscriptStreams') {
  static readonly layer = Layer.effect(this, make)
}
