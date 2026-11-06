import * as Arr from 'effect/Array'
import * as Clock from 'effect/Clock'
import * as Context from 'effect/Context'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import { pipe } from 'effect/Function'
import * as HashMap from 'effect/HashMap'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Queue from 'effect/Queue'
import * as Ref from 'effect/Ref'
import * as Stream from 'effect/Stream'

import { ClaudeSessionFiles } from '@crook/agent/ClaudeSessionFiles'
import { HookInbox } from '@crook/agent/HookInbox'
import { flatMapSome } from '@crook/agent/OptionEffect'
import { type PaneScreen, PaneScreens } from '@crook/agent/PaneScreens'
import {
  type PendingEdit,
  deriveAsk,
  pendingEdit,
  withEditPatch,
} from '@crook/claude/AskDerivation'
import type { PendingPermission } from '@crook/claude/HookLedger'
import { LastTurn, firstUnmatchedToolUse } from '@crook/claude/LastTurn'
import { dialogFingerprint } from '@crook/claude/ScreenDialog'
import { type TranscriptFile, TranscriptLocator } from '@crook/claude/TranscriptLocator'
import type { Ask } from '@crook/domain/Ask'
import type { ClaudeSessionId } from '@crook/domain/Ids'
import type { HerdrRequestError } from '@crook/herdr/HerdrClient'
import type { AgentInfo } from '@crook/herdr/Records'

interface DerivedAsk {
  readonly blockedAs: string
  readonly episode: string
  readonly ask: Ask
}

const EPISODE_SEPARATOR = ':'
const PENDING_SEPARATOR = ','
const CLOSING_DIALOG_HOLD = Duration.seconds(1)

const blockedAsOf = (info: AgentInfo) =>
  [info.terminal_id, info.state_change_seq].join(EPISODE_SEPARATOR)

const episodeOf = (info: AgentInfo, pending: readonly PendingPermission[], read: PaneScreen) =>
  [
    blockedAsOf(info),
    pending.map((permission) => permission.sequence).join(PENDING_SEPARATOR),
    Option.getOrElse(Option.map(read.dialog, dialogFingerprint), () => ''),
  ].join(EPISODE_SEPARATOR)

const isSettled = (info: AgentInfo) => info.agent_status === 'idle' || info.agent_status === 'done'

const isBlankScreen = (read: Option.Option<PaneScreen>) =>
  Option.exists(read, (found) => Option.isNone(found.dialog))

const make = Effect.gen(function* () {
  const screens = yield* PaneScreens
  const inbox = yield* HookInbox
  const sessionFiles = yield* ClaudeSessionFiles
  const locator = yield* TranscriptLocator
  const lastTurn = yield* LastTurn
  const fileSystem = yield* FileSystem.FileSystem
  const derived = yield* Ref.make(HashMap.empty<string, DerivedAsk>())
  const holdsEnded = yield* Queue.sliding<void>(1)
  const scope = yield* Effect.scope

  const screenOf = Effect.fn('PendingAsks.screenOf')(function* (info: AgentInfo) {
    return yield* screens.read(info.pane_id).pipe(
      Effect.asSome,
      Effect.catch((error: HerdrRequestError) =>
        Effect.as(Effect.logWarning(error.message), Option.none<PaneScreen>()),
      ),
    )
  })

  const transcriptToolUse = Effect.fn('PendingAsks.transcriptToolUse')(function* (
    session: ClaudeSessionId,
  ) {
    return yield* locator.locate(session).pipe(
      flatMapSome((file: TranscriptFile) => Effect.map(lastTurn.read(file), firstUnmatchedToolUse)),
      Effect.catch((error) => Effect.as(Effect.logWarning(error.message), Option.none())),
    )
  })

  const patchedEdit = Effect.fn('PendingAsks.patchedEdit')(function* (
    ask: Ask,
    pending: PendingEdit,
  ) {
    return yield* fileSystem.readFileString(pending.edit.filePath).pipe(
      Effect.map((content) => withEditPatch(pending, content)),
      Effect.catch((error) => Effect.as(Effect.logDebug(error.message), ask)),
    )
  })

  const withPatch = (ask: Ask) =>
    Option.match(pendingEdit(ask), {
      onNone: () => Effect.succeed(ask),
      onSome: (pending) => patchedEdit(ask, pending),
    })

  const derive = Effect.fn('PendingAsks.derive')(function* (
    info: AgentInfo,
    session: Option.Option<ClaudeSessionId>,
    pending: readonly PendingPermission[],
    read: Option.Option<PaneScreen>,
  ) {
    const toolUse = Arr.isReadonlyArrayNonEmpty(pending)
      ? Option.none()
      : yield* Option.match(session, {
          onNone: () => Effect.succeedNone,
          onSome: transcriptToolUse,
        })

    return yield* withPatch(
      deriveAsk({
        episode: { terminal: info.terminal_id, stateChangeSeq: info.state_change_seq },
        screen: Option.map(read, (found) => found.screen),
        dialog: Option.flatMap(read, (found) => found.dialog),
        pending,
        toolUse,
      }),
    )
  })

  const settle = (info: AgentInfo, session: Option.Option<ClaudeSessionId>, mark: number) =>
    Ref.update(derived, HashMap.remove(info.pane_id)).pipe(
      Effect.andThen(
        Option.match(
          Option.filter(session, () => isSettled(info)),
          {
            onNone: () => Effect.void,
            onSome: (settled) => inbox.dismissBefore(settled, mark),
          },
        ),
      ),
      Effect.as(Option.none<Ask>()),
    )

  const cachedAsk = (pane: string, episode: string) =>
    Effect.map(Ref.get(derived), (current) =>
      pipe(
        HashMap.get(current, pane),
        Option.filter((entry) => entry.episode === episode),
        Option.map((entry) => entry.ask),
      ),
    )

  const holdLeftAfter = Effect.fn('PendingAsks.holdLeftAfter')(function* (
    session: Option.Option<ClaudeSessionId>,
  ) {
    const leftWaitingAt = yield* Option.match(session, {
      onNone: () => Effect.succeed(Option.none<number>()),
      onSome: sessionFiles.leftWaitingAt,
    })
    const now = yield* Clock.currentTimeMillis

    return pipe(
      leftWaitingAt,
      Option.map((left) => left + Duration.toMillis(CLOSING_DIALOG_HOLD) - now),
      Option.filter((millis) => millis > 0),
    )
  })

  const wakeAfter = (millis: number) =>
    Effect.sleep(Duration.millis(millis)).pipe(
      Effect.andThen(Queue.offer(holdsEnded, undefined)),
      Effect.forkIn(scope),
    )

  const closingAsk = Effect.fn('PendingAsks.closingAsk')(function* (
    info: AgentInfo,
    session: Option.Option<ClaudeSessionId>,
  ) {
    const shown = pipe(
      HashMap.get(yield* Ref.get(derived), info.pane_id),
      Option.filter((entry) => entry.blockedAs === blockedAsOf(info)),
      Option.map((entry) => entry.ask),
    )

    return yield* Option.match(shown, {
      onNone: () => Effect.succeed(Option.none<Ask>()),
      onSome: (ask) =>
        holdLeftAfter(session).pipe(
          flatMapSome((millis) => Effect.as(wakeAfter(millis), Option.some(ask))),
        ),
    })
  })

  const askOnScreen = Effect.fn('PendingAsks.askOnScreen')(function* (
    info: AgentInfo,
    session: Option.Option<ClaudeSessionId>,
    pending: readonly PendingPermission[],
    read: Option.Option<PaneScreen>,
  ) {
    return yield* Option.match(read, {
      onNone: () => derive(info, session, pending, read),
      onSome: (screen) => {
        const episode = episodeOf(info, pending, screen)

        return cachedAsk(info.pane_id, episode).pipe(
          Effect.flatMap(
            Option.match({
              onSome: Effect.succeed,
              onNone: () =>
                derive(info, session, pending, read).pipe(
                  Effect.tap((ask) =>
                    Ref.update(
                      derived,
                      HashMap.set(info.pane_id, {
                        blockedAs: blockedAsOf(info),
                        episode,
                        ask,
                      }),
                    ),
                  ),
                ),
            }),
          ),
        )
      },
    })
  })

  const blockedAsk = Effect.fn('PendingAsks.blockedAsk')(function* (
    info: AgentInfo,
    session: Option.Option<ClaudeSessionId>,
  ) {
    const pending = yield* Option.match(session, {
      onNone: () => Effect.succeed<readonly PendingPermission[]>([]),
      onSome: inbox.pendingFor,
    })
    const read = yield* screenOf(info)
    const closing = isBlankScreen(read) ? yield* closingAsk(info, session) : Option.none<Ask>()

    return yield* Option.match(closing, {
      onSome: Effect.succeed,
      onNone: () => askOnScreen(info, session, pending, read),
    })
  })

  const askOf = (info: AgentInfo, session: Option.Option<ClaudeSessionId>, mark: number) =>
    info.agent_status === 'blocked'
      ? Effect.asSome(blockedAsk(info, session))
      : settle(info, session, mark)

  const retain = (sessions: readonly ClaudeSessionId[], mark: number) =>
    inbox.retain((session) => Arr.contains(sessions, session), mark)

  return PendingAsks.of({
    mark: inbox.position,
    askOf,
    retain,
    changes: Stream.merge(inbox.changes, Stream.fromQueue(holdsEnded)),
  })
})

export class PendingAsks extends Context.Service<
  PendingAsks,
  {
    readonly mark: Effect.Effect<number>
    readonly askOf: (
      info: AgentInfo,
      session: Option.Option<ClaudeSessionId>,
      mark: number,
    ) => Effect.Effect<Option.Option<Ask>>
    readonly retain: (sessions: readonly ClaudeSessionId[], mark: number) => Effect.Effect<void>
    readonly changes: Stream.Stream<void>
  }
>()('@crook/agent/PendingAsks') {
  static readonly layer = Layer.effect(this, make)

  static readonly layerTest = (asks: ReadonlyMap<string, Ask> = new Map()) =>
    Layer.succeed(
      this,
      PendingAsks.of({
        mark: Effect.succeed(0),
        askOf: (info) =>
          Effect.succeed(
            Option.filter(
              Option.fromUndefinedOr(asks.get(info.pane_id)),
              () => info.agent_status === 'blocked',
            ),
          ),
        retain: () => Effect.void,
        changes: Stream.empty,
      }),
    )
}
