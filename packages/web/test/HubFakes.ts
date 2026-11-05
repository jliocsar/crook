import * as Arr from 'effect/Array'
import type * as Cause from 'effect/Cause'
import * as Deferred from 'effect/Deferred'
import type * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as Latch from 'effect/Latch'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Queue from 'effect/Queue'
import * as Ref from 'effect/Ref'
import * as Schema from 'effect/Schema'
import * as Stream from 'effect/Stream'
import * as SubscriptionRef from 'effect/SubscriptionRef'

import { InputDelivered, targetPane } from '@crook/domain/Command'
import type { Command, CommandReceipt, PaneCommand } from '@crook/domain/Command'
import type { HerdView } from '@crook/domain/HerdView'
import { PaneId, TerminalId } from '@crook/domain/Ids'
import type { ClaudeSessionId, IdempotencyKey, MachineId } from '@crook/domain/Ids'
import {
  defaultNotificationPrefs,
  NotificationSettings,
  withPref,
} from '@crook/domain/Notifications'
import type { NotificationEvent } from '@crook/domain/Notifications'
import type { TranscriptEvent, TranscriptSource } from '@crook/domain/Transcript'
import { HubAccount } from '@crook/protocol/ClientApi'
import type { HubStorageFailed } from '@crook/protocol/ClientApi'
import type { CommandFailure } from '@crook/protocol/Commands'
import type { TestNotificationFailure } from '@crook/protocol/Hark'
import { HerdCache } from '@crook/web/cache/HerdCache'
import type { HerdSnapshot } from '@crook/web/cache/HerdCache'
import { StoredTranscript, TranscriptCache } from '@crook/web/cache/TranscriptCache'
import type { StoredKey, TranscriptStore } from '@crook/web/cache/TranscriptCache'
import { applyTranscriptEvent, EMPTY_TRANSCRIPT } from '@crook/web/chat/TranscriptState'
import { HubConnection } from '@crook/web/rpc/HubConnection'
import type {
  ForgetMachineRefused,
  HubCallDefected,
  HubCallFailed,
  SetPinnedRefused,
  TranscriptRequest,
  WatchTranscriptRefused,
} from '@crook/web/rpc/HubConnection'
import { HubLink } from '@crook/web/rpc/HubLink'
import type { HubNotConnected, TranscriptResume } from '@crook/web/rpc/HubLink'
import { HubLinkState, LOGGED_OUT } from '@crook/web/rpc/HubLinkState'
import { PageSignals } from '@crook/web/rpc/PageSignals'
import { SessionCheck } from '@crook/web/rpc/SessionCheck'
import type { LogOutFailed } from '@crook/web/rpc/SessionCheck'

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
  readonly settings: Queue.Queue<NotificationSettings, HubCallFailed | Cause.Done>
  readonly transcripts: Queue.Queue<FakeTranscript>
  readonly transcriptRequests: Ref.Ref<readonly TranscriptRequest[]>
}

export interface PrefWrite {
  readonly event: NotificationEvent
  readonly enabled: boolean
}

export interface SeenCall {
  readonly machine: MachineId
  readonly pane: PaneId
}

export interface PinCall {
  readonly machine: MachineId
  readonly pane: PaneId
  readonly pinned: boolean
}

export interface SentCommand {
  readonly machine: MachineId
  readonly key: IdempotencyKey
  readonly command: Command
}

export interface StoredEntry {
  readonly key: StoredKey
  readonly stored: Schema.Json
}

export interface SeenCall {
  readonly machine: MachineId
  readonly pane: PaneId
}

const NO_COMMAND_ANSWER = Exit.die(
  new Error('This test sent a command without setting its answer.'),
)

export const OWNER_EMAIL = 'owner@example.com'

export const readySettings = new NotificationSettings({
  prefs: defaultNotificationPrefs,
  delivery: 'ready',
})

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
  const saves = yield* Ref.make(0)
  const saveAnswers = yield* Latch.make(true)
  const saveDies = yield* Ref.make(false)
  const visible = yield* SubscriptionRef.make(true)
  const online = yield* SubscriptionRef.make(true)
  const expired = yield* Ref.make(false)
  const sessionCheckTakes = yield* Ref.make(Option.none<Duration.Duration>())
  const logOutRefusal = yield* Ref.make(Option.none<LogOutFailed>())
  const logOuts = yield* Ref.make(0)
  const whileLoggingOut = yield* Ref.make<Effect.Effect<void>>(Effect.void)
  const prefWrites = yield* Ref.make<readonly PrefWrite[]>([])

  const open = Effect.gen(function* () {
    const views = yield* Queue.unbounded<HerdView, HubCallFailed | Cause.Done>()
    const settings = yield* Queue.unbounded<NotificationSettings, HubCallFailed | Cause.Done>()
    const transcripts = yield* Queue.unbounded<FakeTranscript>()
    const transcriptRequests = yield* Ref.make<readonly TranscriptRequest[]>([])

    yield* Ref.update(opened, (count) => count + 1)
    yield* Effect.addFinalizer(() => Ref.update(closed, (count) => count + 1))
    yield* Queue.offer(sessions, { views, settings, transcripts, transcriptRequests })

    return {
      watchHerd: Stream.fromQueue(views),
      markSeen: (machine: MachineId, pane: PaneId) =>
        Ref.update(seen, (calls) => [...calls, { machine, pane }]),
      forgetMachine: (machine: MachineId) =>
        Ref.update(forgotten, (machines) => [...machines, machine]),
      setPinned: () => Effect.void,
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
      watchNotificationSettings: Stream.fromQueue(settings),
      setNotificationPref: (event: NotificationEvent, enabled: boolean) =>
        Ref.update(prefWrites, (writes) => [...writes, { event, enabled }]),
      sendTestNotification: Effect.void,
      account: Effect.succeed(new HubAccount({ email: OWNER_EMAIL })),
    }
  })

  const layer = Layer.mergeAll(
    Layer.succeed(HubConnection, HubConnection.of({ open })),
    Layer.succeed(
      HerdCache,
      HerdCache.of({
        load: Ref.get(saved),
        save: (snapshot) =>
          saveAnswers.await.pipe(
            Effect.andThen(Ref.getAndSet(saveDies, false)),
            Effect.flatMap((dies) =>
              dies ? Effect.die('the snapshot did not encode') : Effect.void,
            ),
            Effect.andThen(Ref.set(saved, Option.some(snapshot))),
            Effect.andThen(Ref.update(saves, (count) => count + 1)),
          ),
        clear: Ref.set(saved, Option.none()),
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
        logOut: Ref.update(logOuts, (count) => count + 1).pipe(
          Effect.andThen(Effect.flatten(Ref.get(whileLoggingOut))),
          Effect.andThen(Ref.get(logOutRefusal)),
          Effect.flatMap(Option.match({ onNone: () => Effect.void, onSome: Effect.fail })),
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
    saves,
    saveAnswers,
    saveDies,
    visible,
    online,
    expired,
    sessionCheckTakes,
    logOutRefusal,
    logOuts,
    whileLoggingOut,
    prefWrites,
  }
})

export const makeMemoryTranscriptStore = Effect.fn('makeMemoryTranscriptStore')(function* () {
  const entries = yield* Ref.make<ReadonlyMap<string, StoredEntry>>(new Map())
  const idOf = (key: StoredKey) => JSON.stringify(key)

  const store: TranscriptStore = {
    keys: Effect.map(Ref.get(entries), (current) =>
      Array.from(current.values(), (entry) => entry.key),
    ),
    read: (key) => Effect.map(Ref.get(entries), (current) => current.get(idOf(key))?.stored),
    write: (key, stored) =>
      Ref.update(entries, (current) => new Map([...current, [idOf(key), { key, stored }]])),
    remove: (stale) =>
      Ref.update(
        entries,
        (current) => new Map([...current].filter(([id]) => !stale.some((key) => idOf(key) === id))),
      ),
  }

  return { store, entries }
})

export const makeFakeHubLink = Effect.fn('makeFakeHubLink')(function* (initial: HubLinkState) {
  const state = yield* SubscriptionRef.make(initial)
  const stateReads = yield* Latch.make(true)
  const stateDefect = yield* Deferred.make<never>()
  const seen = yield* Ref.make<readonly SeenCall[]>([])
  const resyncs = yield* Ref.make(0)
  const forgotten = yield* Ref.make<readonly MachineId[]>([])
  const forgetRefusal = yield* Ref.make(
    Option.none<ForgetMachineRefused | HubCallFailed | HubNotConnected>(),
  )
  const forgetAnswers = yield* Latch.make(true)
  const pins = yield* Ref.make<readonly PinCall[]>([])
  const pinRefusal = yield* Ref.make(
    Option.none<SetPinnedRefused | HubCallFailed | HubNotConnected>(),
  )
  const transcripts = yield* Ref.make<ReadonlyMap<string, LinkTranscript>>(new Map())
  const resumes = yield* Ref.make<readonly TranscriptResume[]>([])
  const sent = yield* Ref.make<readonly SentCommand[]>([])
  const commandAnswer =
    yield* Ref.make<Exit.Exit<CommandReceipt, CommandFailure | HubCallFailed | HubNotConnected>>(
      NO_COMMAND_ANSWER,
    )
  const commandAnswers = yield* Latch.make(true)

  const settings = yield* SubscriptionRef.make(readySettings)
  const account = yield* SubscriptionRef.make(new HubAccount({ email: OWNER_EMAIL }))
  const settingsReads = yield* Latch.make(true)
  const settingsFailure = yield* Ref.make(Option.none<HubCallDefected>())
  const prefWrites = yield* Ref.make<readonly PrefWrite[]>([])
  const prefAttempts = yield* Ref.make<readonly PrefWrite[]>([])
  const prefRefusal = yield* Ref.make(
    Option.none<HubStorageFailed | HubCallFailed | HubNotConnected>(),
  )
  const prefAnswers = yield* Latch.make(true)
  const testSends = yield* Ref.make(0)
  const testRefusal = yield* Ref.make(
    Option.none<TestNotificationFailure | HubCallFailed | HubNotConnected>(),
  )
  const testAnswers = yield* Latch.make(true)
  const logOuts = yield* Ref.make(0)
  const logOutRefusal = yield* Ref.make(Option.none<LogOutFailed>())
  const logOutAnswers = yield* Latch.make(true)
  const transcriptStore = yield* makeMemoryTranscriptStore()
  const pageVisible = yield* SubscriptionRef.make(true)

  const answerWith = <Failure>(
    answers: Latch.Latch,
    refusal: Ref.Ref<Option.Option<Failure>>,
    accepted: Effect.Effect<void>,
  ) =>
    Effect.andThen(
      answers.await,
      Effect.flatMap(
        Ref.get(refusal),
        Option.match({ onNone: () => accepted, onSome: Effect.fail }),
      ),
    )

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

  const endTranscript = Effect.fn('endTranscript')(function* (
    source: TranscriptSource,
    failure: WatchTranscriptRefused | HubCallDefected,
  ) {
    const ending = yield* transcriptFor(source)

    yield* Ref.update(
      transcripts,
      (current) => new Map([...current].filter(([key]) => key !== sourceKey(source))),
    )
    yield* Queue.fail(ending, failure)
  })

  const transcriptCacheLayer = Layer.provide(
    TranscriptCache.layerOver(transcriptStore.store),
    Layer.succeed(
      PageSignals,
      PageSignals.of({
        visible: SubscriptionRef.changes(pageVisible),
        online: Stream.make(true),
      }),
    ),
  )

  const linkLayer = Layer.succeed(
    HubLink,
    HubLink.of({
      changes: Stream.merge(
        Stream.unwrap(Effect.as(stateReads.await, SubscriptionRef.changes(state))),
        Stream.fromEffectDrain(Deferred.await(stateDefect)),
      ),
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
      setPinned: (machine, pane, pinned) =>
        Effect.andThen(
          Ref.update(pins, (calls) => [...calls, { machine, pane, pinned }]),
          Effect.flatMap(
            Ref.get(pinRefusal),
            Option.match({ onNone: () => Effect.void, onSome: Effect.fail }),
          ),
        ),
      sendCommand: (machine, key, command) =>
        Effect.andThen(
          Ref.update(sent, (commands) => [...commands, { machine, key, command }]),
          Effect.andThen(commandAnswers.await, Effect.flatten(Ref.get(commandAnswer))),
        ),
      notificationSettings: Stream.unwrap(
        settingsReads.await.pipe(
          Effect.andThen(Ref.get(settingsFailure)),
          Effect.flatMap(Option.match({ onNone: () => Effect.void, onSome: Effect.fail })),
          Effect.as(SubscriptionRef.changes(settings)),
        ),
      ),
      account: Stream.unwrap(
        settingsReads.await.pipe(
          Effect.andThen(Ref.get(settingsFailure)),
          Effect.flatMap(Option.match({ onNone: () => Effect.void, onSome: Effect.fail })),
          Effect.as(SubscriptionRef.changes(account)),
        ),
      ),
      setNotificationPref: (event, enabled) =>
        Effect.andThen(
          Ref.update(prefAttempts, (attempts) => [...attempts, { event, enabled }]),
          answerWith(
            prefAnswers,
            prefRefusal,
            Effect.andThen(
              Ref.update(prefWrites, (writes) => [...writes, { event, enabled }]),
              SubscriptionRef.update(
                settings,
                (current) =>
                  new NotificationSettings({
                    prefs: withPref(current.prefs, event, enabled),
                    delivery: current.delivery,
                  }),
              ),
            ),
          ),
        ),
      sendTestNotification: answerWith(
        testAnswers,
        testRefusal,
        Ref.update(testSends, (count) => count + 1),
      ),
      logOut: answerWith(
        logOutAnswers,
        logOutRefusal,
        Effect.andThen(
          Ref.update(logOuts, (count) => count + 1),
          SubscriptionRef.set(state, new HubLinkState({ status: LOGGED_OUT, herd: Option.none() })),
        ),
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

  const layer = Layer.mergeAll(linkLayer, transcriptCacheLayer)

  return {
    layer,
    transcriptStore: transcriptStore.store,
    storedTranscripts: transcriptStore.entries,
    pageVisible,
    state,
    stateReads,
    stateDefect,
    seen,
    resyncs,
    forgotten,
    forgetRefusal,
    forgetAnswers,
    pins,
    pinRefusal,
    transcriptFor,
    endTranscript,
    resumes,
    sent,
    commandAnswer,
    commandAnswers,
    settings,
    account,
    settingsReads,
    settingsFailure,
    prefWrites,
    prefAttempts,
    prefRefusal,
    prefAnswers,
    testSends,
    testRefusal,
    testAnswers,
    logOuts,
    logOutRefusal,
    logOutAnswers,
  }
})

export type FakeHubLink = Effect.Success<ReturnType<typeof makeFakeHubLink>>

const encodeStoredTranscript = Schema.encodeEffect(Schema.toCodecJson(StoredTranscript))

export const keepOnThisDevice = Effect.fn('keepOnThisDevice')(function* (
  link: FakeHubLink,
  key: { readonly machine: MachineId; readonly pane: PaneId; readonly session: ClaudeSessionId },
  events: readonly TranscriptEvent[],
) {
  const view = Arr.reduce(events, EMPTY_TRANSCRIPT, applyTranscriptEvent)
  const position = yield* Effect.fromOption(view.position)
  const stored = yield* encodeStoredTranscript(
    new StoredTranscript({ position, lines: view.lines, rosters: view.rosters }),
  )

  yield* link.transcriptStore.write([key.machine, 'pane', key.pane, key.session], stored)
}, Effect.orDie)

export const dropSession = (session: FakeSession, error: HubCallFailed) =>
  Queue.fail(session.views, error)
