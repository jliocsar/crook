import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as HashMap from 'effect/HashMap'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Ref from 'effect/Ref'
import * as Stream from 'effect/Stream'

import { HookInbox } from '@crook/agent/HookInbox'
import { flatMapSome } from '@crook/agent/OptionEffect'
import { deriveAsk, editToPatch, withEditPatch } from '@crook/claude/AskDerivation'
import type { PendingPermission } from '@crook/claude/HookLedger'
import { LastTurn, firstUnmatchedToolUse } from '@crook/claude/LastTurn'
import { type PermissionDialog, parseDialog } from '@crook/claude/PermissionDialog'
import { type TranscriptFile, TranscriptLocator } from '@crook/claude/TranscriptLocator'
import type { Ask } from '@crook/domain/Ask'
import type { ClaudeSessionId } from '@crook/domain/Ids'
import { HerdrClient, type HerdrRequestError } from '@crook/herdr/HerdrClient'
import { PaneReadMethod } from '@crook/herdr/Methods'
import type { AgentInfo } from '@crook/herdr/Records'

interface DerivedAsk {
  readonly episode: string
  readonly ask: Ask
}

export interface PaneScreen {
  readonly screen: string
  readonly dialog: Option.Option<PermissionDialog>
}

const episodeOf = (info: AgentInfo, pending: Option.Option<PendingPermission>) =>
  [
    info.terminal_id,
    info.state_change_seq,
    Option.match(pending, { onNone: () => '', onSome: (found) => String(found.sequence) }),
  ].join(':')

const isSettled = (info: AgentInfo) => info.agent_status === 'idle' || info.agent_status === 'done'

export const readPaneScreen = Effect.fn('PendingAsks.readPaneScreen')(function* (
  herdr: Context.Service.Shape<typeof HerdrClient>,
  pane: string,
) {
  const reply = yield* herdr.request(PaneReadMethod, { pane_id: pane, source: 'detection' })

  return { screen: reply.read.text, dialog: parseDialog(reply.read.text) }
})

const make = Effect.gen(function* () {
  const herdr = yield* HerdrClient
  const inbox = yield* HookInbox
  const locator = yield* TranscriptLocator
  const lastTurn = yield* LastTurn
  const fileSystem = yield* FileSystem.FileSystem
  const derived = yield* Ref.make(HashMap.empty<string, DerivedAsk>())

  const screenOf = Effect.fn('PendingAsks.screenOf')(function* (info: AgentInfo) {
    return yield* readPaneScreen(herdr, info.pane_id).pipe(
      Effect.map(Option.some),
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

  const patchedEdit = Effect.fn('PendingAsks.patchedEdit')(function* (ask: Ask, filePath: string) {
    return yield* fileSystem.readFileString(filePath).pipe(
      Effect.map((content) => withEditPatch(ask, content)),
      Effect.catch((error) => Effect.as(Effect.logDebug(error.message), ask)),
    )
  })

  const withPatch = (ask: Ask) =>
    Option.match(editToPatch(ask), {
      onNone: () => Effect.succeed(ask),
      onSome: (edit) => patchedEdit(ask, edit.filePath),
    })

  const derive = Effect.fn('PendingAsks.derive')(function* (
    info: AgentInfo,
    session: Option.Option<ClaudeSessionId>,
    pending: Option.Option<PendingPermission>,
  ) {
    const read = yield* screenOf(info)
    const toolUse = Option.isSome(pending)
      ? Option.none()
      : yield* flatMapSome(transcriptToolUse)(Effect.succeed(session))

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

  const blockedAsk = Effect.fn('PendingAsks.blockedAsk')(function* (
    info: AgentInfo,
    session: Option.Option<ClaudeSessionId>,
  ) {
    const pending = yield* Option.match(session, {
      onNone: () => Effect.succeedNone,
      onSome: inbox.pendingFor,
    })
    const episode = episodeOf(info, pending)
    const cached = HashMap.get(yield* Ref.get(derived), info.pane_id).pipe(
      Option.filter((entry) => entry.episode === episode),
    )

    return yield* Option.match(cached, {
      onSome: (entry) => Effect.succeed(entry.ask),
      onNone: () =>
        derive(info, session, pending).pipe(
          Effect.tap((ask) => Ref.update(derived, HashMap.set(info.pane_id, { episode, ask }))),
        ),
    })
  })

  const askOf = (info: AgentInfo, session: Option.Option<ClaudeSessionId>, mark: number) =>
    info.agent_status === 'blocked'
      ? Effect.map(blockedAsk(info, session), Option.some)
      : settle(info, session, mark)

  return PendingAsks.of({ mark: inbox.position, askOf, changes: inbox.changes })
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
    readonly changes: Stream.Stream<void>
  }
>()('@crook/agent/PendingAsks') {
  static readonly layerFromServices = Layer.effect(this, make)

  static readonly layer = this.layerFromServices.pipe(
    Layer.provide([HookInbox.layer, TranscriptLocator.layer, LastTurn.layer]),
  )

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
        changes: Stream.empty,
      }),
    )
}
