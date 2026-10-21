import type * as Cause from 'effect/Cause'
import type * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as Latch from 'effect/Latch'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Queue from 'effect/Queue'
import * as Ref from 'effect/Ref'
import * as Stream from 'effect/Stream'
import * as SubscriptionRef from 'effect/SubscriptionRef'

import { InputDelivered, targetPane } from '@crook/domain/Command'
import type { Command, CommandReceipt, PaneCommand } from '@crook/domain/Command'
import type { HerdView } from '@crook/domain/HerdView'
import { PaneId, TerminalId } from '@crook/domain/Ids'
import type { IdempotencyKey, MachineId } from '@crook/domain/Ids'
import type { TranscriptEvent, TranscriptSource } from '@crook/domain/Transcript'
import type { CommandFailure } from '@crook/protocol/Commands'
import { HerdCache } from '@crook/web/cache/HerdCache'
import type { HerdSnapshot } from '@crook/web/cache/HerdCache'
import { HubConnection } from '@crook/web/rpc/HubConnection'
import type {
  ForgetMachineRefused,
  HubCallDefected,
  HubCallFailed,
  TranscriptRequest,
  WatchTranscriptRefused,
} from '@crook/web/rpc/HubConnection'
import { HubLink } from '@crook/web/rpc/HubLink'
import type { HubNotConnected, TranscriptResume } from '@crook/web/rpc/HubLink'
import type { HubLinkState } from '@crook/web/rpc/HubLinkState'
import { PageSignals } from '@crook/web/rpc/PageSignals'
import { SessionCheck } from '@crook/web/rpc/SessionCheck'

export type FakeTranscript = Queue.Queue<
  TranscriptEvent,
  WatchTranscriptRefused | HubCallFailed | Cause.Done
>

export type LinkTranscript = Queue.Queue<
  TranscriptEvent,
  WatchTranscriptRefused | HubCallDefected | Cause.Done
>

export interface FakeSession {
  readonly views: Queue.Queue<HerdView, HubCallFailed | Cause.Done>
  readonly transcripts: Queue.Queue<FakeTranscript>
  readonly transcriptRequests: Ref.Ref<readonly TranscriptRequest[]>
}

export interface SentCommand {
  readonly machine: MachineId
  readonly key: IdempotencyKey
  readonly command: Command
}

export interface SeenCall {
  readonly machine: MachineId
  readonly pane: PaneId
}

const NO_COMMAND_ANSWER = Exit.die(
  new Error('This test sent a command without setting its answer.'),
)

export const STARTED_PANE = PaneId.make('w1:p9')

export const sourceKey = (source: TranscriptSource): string =>
  Match.value(source).pipe(
    Match.tagsExhaustive({
      PaneTranscript: ({ pane }) => `pane ${pane}`,
      SubagentTranscript: ({ session, subagent }) => `subagent ${session} ${subagent}`,
    }),
  )

export const inputDelivered = (command: PaneCommand, stateChangeSeq = 1) =>
  new InputDelivered({
    pane: targetPane(command),
    terminal: TerminalId.make(`term_${targetPane(command)}`),
    stateChangeSeq,
  })

export const makeFakeBrowser = Effect.fn('makeFakeBrowser')(function* (
  cached: Option.Option<HerdSnapshot>,
) {
  const sessions = yield* Queue.unbounded<FakeSession>()
  const opened = yield* Ref.make(0)
  const closed = yield* Ref.make(0)
  const seen = yield* Ref.make<readonly SeenCall[]>([])
  const forgotten = yield* Ref.make<readonly MachineId[]>([])
  const sent = yield* Ref.make<readonly SentCommand[]>([])
  const commandAnswer =
    yield* Ref.make<Exit.Exit<CommandReceipt, CommandFailure | HubCallFailed>>(NO_COMMAND_ANSWER)
  const saved = yield* Ref.make(cached)
  const visible = yield* SubscriptionRef.make(true)
  const online = yield* SubscriptionRef.make(true)
  const expired = yield* Ref.make(false)
  const sessionCheckTakes = yield* Ref.make(Option.none<Duration.Duration>())

  const open = Effect.gen(function* () {
    const views = yield* Queue.unbounded<HerdView, HubCallFailed | Cause.Done>()
    const transcripts = yield* Queue.unbounded<FakeTranscript>()
    const transcriptRequests = yield* Ref.make<readonly TranscriptRequest[]>([])

    yield* Ref.update(opened, (count) => count + 1)
    yield* Effect.addFinalizer(() => Ref.update(closed, (count) => count + 1))
    yield* Queue.offer(sessions, { views, transcripts, transcriptRequests })

    return {
      watchHerd: Stream.fromQueue(views),
      markSeen: (machine: MachineId, pane: PaneId) =>
        Ref.update(seen, (calls) => [...calls, { machine, pane }]),
      forgetMachine: (machine: MachineId) =>
        Ref.update(forgotten, (machines) => [...machines, machine]),
      watchTranscript: (request: TranscriptRequest) =>
        Stream.unwrap(
          Effect.gen(function* () {
            const transcript = yield* Queue.unbounded<
              TranscriptEvent,
              WatchTranscriptRefused | HubCallFailed | Cause.Done
            >()

            yield* Ref.update(transcriptRequests, (requests) => [...requests, request])
            yield* Queue.offer(transcripts, transcript)

            return Stream.fromQueue(transcript)
          }),
        ),
      sendCommand: (machine: MachineId, key: IdempotencyKey, command: Command) =>
        Effect.andThen(
          Ref.update(sent, (commands) => [...commands, { machine, key, command }]),
          Effect.flatten(Ref.get(commandAnswer)),
        ),
    }
  })

  const layer = Layer.mergeAll(
    Layer.succeed(HubConnection, HubConnection.of({ open })),
    Layer.succeed(
      HerdCache,
      HerdCache.of({
        load: Ref.get(saved),
        save: (snapshot) => Ref.set(saved, Option.some(snapshot)),
      }),
    ),
    Layer.succeed(
      PageSignals,
      PageSignals.of({
        visible: SubscriptionRef.changes(visible),
        online: SubscriptionRef.changes(online),
      }),
    ),
    Layer.succeed(
      SessionCheck,
      SessionCheck.of({
        expired: Effect.andThen(
          Effect.flatMap(
            Ref.get(sessionCheckTakes),
            Option.match({ onNone: () => Effect.void, onSome: Effect.sleep }),
          ),
          Ref.get(expired),
        ),
      }),
    ),
  )

  return {
    layer,
    sessions,
    opened,
    closed,
    seen,
    forgotten,
    sent,
    commandAnswer,
    saved,
    visible,
    online,
    expired,
    sessionCheckTakes,
  }
})

export const makeFakeHubLink = Effect.fn('makeFakeHubLink')(function* (initial: HubLinkState) {
  const state = yield* SubscriptionRef.make(initial)
  const seen = yield* Ref.make<readonly SeenCall[]>([])
  const resyncs = yield* Ref.make(0)
  const forgotten = yield* Ref.make<readonly MachineId[]>([])
  const forgetRefusal = yield* Ref.make(
    Option.none<ForgetMachineRefused | HubCallFailed | HubNotConnected>(),
  )
  const forgetAnswers = yield* Latch.make(true)
  const transcripts = yield* Ref.make<ReadonlyMap<string, LinkTranscript>>(new Map())
  const resumes = yield* Ref.make<readonly TranscriptResume[]>([])
  const sent = yield* Ref.make<readonly SentCommand[]>([])
  const commandAnswer =
    yield* Ref.make<Exit.Exit<CommandReceipt, CommandFailure | HubCallFailed | HubNotConnected>>(
      NO_COMMAND_ANSWER,
    )
  const commandAnswers = yield* Latch.make(true)

  const transcriptFor = Effect.fn('transcriptFor')(function* (source: TranscriptSource) {
    const known = (yield* Ref.get(transcripts)).get(sourceKey(source))

    if (known !== undefined) {
      return known
    }

    const created = yield* Queue.unbounded<
      TranscriptEvent,
      WatchTranscriptRefused | HubCallDefected | Cause.Done
    >()

    yield* Ref.update(transcripts, (current) => new Map([...current, [sourceKey(source), created]]))

    return created
  })

  const layer = Layer.succeed(
    HubLink,
    HubLink.of({
      changes: SubscriptionRef.changes(state),
      resync: Ref.update(resyncs, (count) => count + 1),
      markSeen: (machine, pane) => Ref.update(seen, (calls) => [...calls, { machine, pane }]),
      forgetMachine: (machine) =>
        Effect.andThen(
          forgetAnswers.await,
          Effect.flatMap(
            Ref.get(forgetRefusal),
            Option.match({
              onNone: () => Ref.update(forgotten, (machines) => [...machines, machine]),
              onSome: Effect.fail,
            }),
          ),
        ),
      sendCommand: (machine, key, command) =>
        Effect.andThen(
          Ref.update(sent, (commands) => [...commands, { machine, key, command }]),
          Effect.andThen(commandAnswers.await, Effect.flatten(Ref.get(commandAnswer))),
        ),
      watchTranscript: (_machine, source, resume) =>
        Stream.unwrap(
          Effect.gen(function* () {
            const from = yield* resume

            yield* Ref.update(resumes, (current) => [...current, from])

            return Stream.fromQueue(yield* transcriptFor(source))
          }),
        ),
    }),
  )

  return {
    layer,
    state,
    seen,
    resyncs,
    forgotten,
    forgetRefusal,
    forgetAnswers,
    transcriptFor,
    resumes,
    sent,
    commandAnswer,
    commandAnswers,
  }
})

export const dropSession = (session: FakeSession, error: HubCallFailed) =>
  Queue.fail(session.views, error)
