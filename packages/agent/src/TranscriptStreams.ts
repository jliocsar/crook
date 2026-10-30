import * as Arr from 'effect/Array'
import * as Cause from 'effect/Cause'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as Equivalence from 'effect/Equivalence'
import * as FiberMap from 'effect/FiberMap'
import { pipe } from 'effect/Function'
import * as HashSet from 'effect/HashSet'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Ref from 'effect/Ref'
import * as Schema from 'effect/Schema'
import * as Stream from 'effect/Stream'
import type { RpcClientError } from 'effect/rpc/RpcClientError'

import { MachineStateSync } from '@crook/agent/MachineStateSync'
import { MANAGED_SKILL_HOMES, SkillCatalog } from '@crook/claude/SkillCatalog'
import { SubagentRoster, type SubagentsUnreadable } from '@crook/claude/SubagentRoster'
import {
  type LocateError,
  type TranscriptFile,
  TranscriptLocator,
} from '@crook/claude/TranscriptLocator'
import { type TailError, TranscriptTail } from '@crook/claude/TranscriptTail'
import type { ClaudeSessionId, PaneId, SubagentId, TranscriptOffset } from '@crook/domain/Ids'
import type { Subagent } from '@crook/domain/Subagent'
import {
  SkillsChanged,
  SubagentsChanged,
  TRANSCRIPT_START,
  TranscriptCaughtUp,
  type TranscriptEvent,
  TranscriptOpened,
  type TranscriptPosition,
  type TranscriptSource,
  type TranscriptTailBytes,
  omittedUpTo,
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
} from '@crook/protocol/Transcripts'

export type FollowError = LocateError | TailError | SubagentsUnreadable

interface PaneSession {
  readonly session: ClaudeSessionId
  readonly cwd: string
}

export interface TranscriptLink {
  readonly demands: Stream.Stream<TranscriptDemand, RpcClientError>
  readonly publish: (
    watch: TranscriptWatchId,
    update: TranscriptUpdate,
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

const followFailed = (error: FollowError) =>
  failedWith(toWireFailure(error), Effect.logWarning(error.message))

const followDefected = (defect: Cause.Cause<never>) =>
  failedWith(
    new TranscriptReadFailed({
      detail: `a bug in the crook agent stopped the watch: ${Cause.pretty(defect)}`,
    }),
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

const finalRoster = Effect.fn('TranscriptStreams.finalRoster')(function* (
  roster: SubagentRoster['Service'],
  file: TranscriptFile,
) {
  return yield* roster.read(file).pipe(
    Effect.map((subagents) => Stream.succeed(rosterOf(file.session)(subagents))),
    Effect.catch((error) =>
      Effect.as(
        Effect.logWarning(
          `Sent no final subagent list for the session the pane left: ${error.message}`,
        ),
        Stream.empty,
      ),
    ),
  )
})

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

const make = Effect.gen(function* () {
  const sync = yield* MachineStateSync
  const locator = yield* TranscriptLocator
  const tail = yield* TranscriptTail
  const roster = yield* SubagentRoster
  const catalog = yield* SkillCatalog

  const fromLineNearEnd = (
    file: TranscriptFile,
    offset: TranscriptOffset,
    tailBytes: Option.Option<TranscriptTailBytes>,
    read: (from: TranscriptOffset) => Stream.Stream<TranscriptEvent, FollowError>,
  ): Stream.Stream<TranscriptEvent, FollowError> =>
    pipe(
      tailBytes,
      Option.filter(() => offset === TRANSCRIPT_START),
      Option.match({
        onNone: () => read(offset),
        onSome: (bytes) =>
          Stream.unwrap(
            Effect.map(tail.tailStart(file, bytes), (start) =>
              start === TRANSCRIPT_START
                ? read(start)
                : Stream.concat(
                    Stream.succeed<TranscriptEvent>(omittedUpTo(file.session, start)),
                    read(start),
                  ),
            ),
          ),
      }),
    )

  const live = (file: TranscriptFile, offset: TranscriptOffset) =>
    Stream.merge(tail.follow(file, offset), Stream.map(roster.watch(file), rosterOf(file.session)))

  const openSession = (
    { session, cwd }: PaneSession,
    offset: TranscriptOffset,
    tailBytes: Option.Option<TranscriptTailBytes>,
  ) => {
    const following = (file: TranscriptFile) =>
      fromLineNearEnd(file, offset, tailBytes, (from) => live(file, from))

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

  const finishSession = (
    position: TranscriptPosition,
    tailBytes: Option.Option<TranscriptTailBytes>,
  ) =>
    Stream.unwrap(
      Effect.map(
        locator.locate(position.session),
        Option.match({
          onNone: () => Stream.empty,
          onSome: (file) =>
            Stream.concat(
              fromLineNearEnd(file, position.offset, tailBytes, (from) => tail.drain(file, from)),
              Stream.unwrap(finalRoster(roster, file)),
            ),
        }),
      ),
    )

  const fromSession = (
    paneSession: PaneSession,
    position: Option.Option<TranscriptPosition>,
    tailBytes: Option.Option<TranscriptTailBytes>,
  ) =>
    Option.match(position, {
      onNone: () => openSession(paneSession, TRANSCRIPT_START, tailBytes),
      onSome: (at) =>
        at.session === paneSession.session
          ? openSession(paneSession, at.offset, tailBytes)
          : Stream.concat(
              finishSession(at, tailBytes),
              openSession(paneSession, TRANSCRIPT_START, tailBytes),
            ),
    })

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
                  Effect.map(Ref.get(position), (at) => fromSession(paneSession, at, tailBytes)),
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
    const attempt = Effect.fn('TranscriptStreams.attempt')(function* (
      from: Option.Option<TranscriptPosition>,
    ): Effect.fn.Return<void, RpcClientError> {
      return yield* follow(watch.source, from, watch.tail).pipe(
        Stream.catch(followFailed),
        Stream.catchDefect((defect) => followDefected(Cause.die(defect))),
        Stream.runForEach((update) => link.publish(watch.id, update)),
        Effect.catchTag('TranscriptOutOfStep', (outOfStep) =>
          Effect.andThen(Effect.logDebug(outOfStep.message), attempt(outOfStep.expected)),
        ),
      )
    })

    return attempt(watch.from).pipe(
      Effect.catchTag('RpcClientError', (error) => Effect.logDebug(error.message)),
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
  static readonly layerWithoutDependencies = Layer.effect(this, make)

  static readonly layerAt = (roots: readonly string[]) =>
    this.layerWithoutDependencies.pipe(
      Layer.provide([
        TranscriptLocator.layerAt(roots),
        TranscriptTail.layer,
        SubagentRoster.layer,
        SkillCatalog.layerAt(roots, MANAGED_SKILL_HOMES),
      ]),
    )

  static readonly layer = this.layerWithoutDependencies.pipe(
    Layer.provide([
      TranscriptLocator.layer,
      TranscriptTail.layer,
      SubagentRoster.layer,
      SkillCatalog.layer,
    ]),
  )
}
