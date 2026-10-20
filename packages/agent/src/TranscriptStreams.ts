import * as Arr from 'effect/Array'
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
import { SubagentRoster, type SubagentsUnreadable } from '@crook/claude/SubagentRoster'
import {
  type LocateError,
  type TranscriptFile,
  TranscriptLocator,
} from '@crook/claude/TranscriptLocator'
import { type TailError, TranscriptTail } from '@crook/claude/TranscriptTail'
import type { ClaudeSessionId, PaneId, SubagentId, TranscriptOffset } from '@crook/domain/Ids'
import {
  SubagentsChanged,
  TRANSCRIPT_START,
  type TranscriptEvent,
  TranscriptOpened,
  type TranscriptPosition,
  type TranscriptSource,
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

const sameSession = Option.makeEquivalence(Equivalence.strictEqual<ClaudeSessionId>())

export const toWireFailure = (error: FollowError): TranscriptFailure =>
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

const startIn = (session: ClaudeSessionId, from: Option.Option<TranscriptPosition>) =>
  pipe(
    from,
    Option.filter((position) => position.session === session),
    Option.match({ onNone: () => TRANSCRIPT_START, onSome: (position) => position.offset }),
  )

const make = Effect.gen(function* () {
  const sync = yield* MachineStateSync
  const locator = yield* TranscriptLocator
  const tail = yield* TranscriptTail
  const roster = yield* SubagentRoster

  const opened = (session: ClaudeSessionId) =>
    Stream.succeed<TranscriptEvent>(new TranscriptOpened({ session }))

  const live = (file: TranscriptFile, offset: TranscriptOffset) =>
    Stream.merge(
      tail.follow(file, offset),
      roster
        .watch(file)
        .pipe(
          Stream.map((subagents) => new SubagentsChanged({ session: file.session, subagents })),
        ),
    )

  const openSession = (session: ClaudeSessionId, offset: TranscriptOffset) =>
    Stream.concat(
      opened(session),
      Stream.unwrap(Effect.map(locator.await(session), (file) => live(file, offset))),
    )

  const finishSession = (position: TranscriptPosition) =>
    Stream.unwrap(
      Effect.map(
        locator.locate(position.session),
        Option.match({
          onNone: () => Stream.empty,
          onSome: (file) => tail.drain(file, position.offset),
        }),
      ),
    )

  const fromSession = (session: ClaudeSessionId, position: Option.Option<TranscriptPosition>) =>
    Option.match(position, {
      onNone: () => openSession(session, TRANSCRIPT_START),
      onSome: (at) =>
        at.session === session
          ? openSession(session, at.offset)
          : Stream.concat(finishSession(at), openSession(session, TRANSCRIPT_START)),
    })

  const sessionsOf = (pane: PaneId) =>
    sync.changes.pipe(
      Stream.map((state) =>
        pipe(
          Arr.findFirst(state.agents, (row) => row.pane === pane),
          Option.flatMap((row) => row.claudeSession),
        ),
      ),
      Stream.changesWith(sameSession),
    )

  const followPane = (pane: PaneId, from: Option.Option<TranscriptPosition>) =>
    Stream.unwrap(
      Effect.map(Ref.make(from), (position) =>
        sessionsOf(pane).pipe(
          Stream.switchMap(
            Option.match({
              onNone: () => Stream.never,
              onSome: (session) =>
                Stream.unwrap(Effect.map(Ref.get(position), (at) => fromSession(session, at))),
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
  ) =>
    Stream.concat(
      opened(session),
      Stream.unwrap(
        locator.await(session).pipe(
          Effect.flatMap((file) => locator.awaitSubagent(file, subagent)),
          Effect.map((file) => tail.follow(file, startIn(session, from))),
        ),
      ),
    )

  const follow = (
    source: TranscriptSource,
    from: Option.Option<TranscriptPosition>,
  ): Stream.Stream<TranscriptEvent, FollowError> =>
    Match.value(source).pipe(
      Match.tagsExhaustive({
        PaneTranscript: ({ pane }) => followPane(pane, from),
        SubagentTranscript: ({ session, subagent }) => followSubagent(session, subagent, from),
      }),
    )

  const runWatch = (link: TranscriptLink, watch: TranscriptWatch) => {
    const attempt = (
      from: Option.Option<TranscriptPosition>,
    ): Effect.Effect<void, RpcClientError> =>
      follow(watch.source, from).pipe(
        Stream.runForEach((event) => link.publish(watch.id, event)),
        Effect.catchTag('TranscriptOutOfStep', (outOfStep) =>
          Effect.andThen(Effect.logDebug(outOfStep.message), attempt(outOfStep.expected)),
        ),
        Effect.catchTags({
          TranscriptSessionInvalid: (error) => failWatch(error),
          TranscriptDirectoryUnreadable: (error) => failWatch(error),
          TranscriptUnreadable: (error) => failWatch(error),
          SubagentsUnreadable: (error) => failWatch(error),
          TranscriptOffsetBeyondEnd: (error) => failWatch(error),
          TranscriptOffsetMidLine: (error) => failWatch(error),
          TranscriptShrank: (error) => failWatch(error),
        }),
      )

    const failWatch = (error: FollowError) =>
      Effect.andThen(
        Effect.logWarning(error.message),
        link.publish(watch.id, new TranscriptWatchFailed({ failure: toWireFailure(error) })),
      ).pipe(
        Effect.catchTag('TranscriptOutOfStep', (outOfStep) => Effect.logDebug(outOfStep.message)),
      )

    return attempt(watch.from).pipe(
      Effect.catchDefect((defect) =>
        Effect.logWarning('A transcript watch died; the hub will not hear from it again.', defect),
      ),
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
    ) => Stream.Stream<TranscriptEvent, FollowError>
    readonly serve: (
      link: TranscriptLink,
    ) => Effect.Effect<never, TranscriptDemandsEnded | RpcClientError>
  }
>()('@crook/agent/TranscriptStreams') {
  static readonly layerWithoutDependencies = Layer.effect(this, make)

  static readonly layerAt = (roots: readonly string[]) =>
    this.layerWithoutDependencies.pipe(
      Layer.provide([TranscriptLocator.layerAt(roots), TranscriptTail.layer, SubagentRoster.layer]),
    )

  static readonly layer = this.layerWithoutDependencies.pipe(
    Layer.provide([TranscriptLocator.layer, TranscriptTail.layer, SubagentRoster.layer]),
  )
}
