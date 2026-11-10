import * as Arr from 'effect/Array'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'

import { ClaudeSessionFiles } from '@crook/agent/ClaudeSessionFiles'
import { CreatedPanes } from '@crook/agent/CreatedPanes'
import { MachineStateSync } from '@crook/agent/MachineStateSync'
import type { AgentRow } from '@crook/domain/AgentRow'
import { type AnswerAsk, type ClosePane, type PaneCommand, targetPane } from '@crook/domain/Command'
import {
  AskNotPending,
  type HerdrRefusedCommand,
  PaneNotAgent,
  PaneNotCreatedByCrook,
  claudeWaitingRefusal,
} from '@crook/protocol/Commands'

const make = Effect.gen(function* () {
  const sync = yield* MachineStateSync
  const createdPanes = yield* CreatedPanes
  const sessionFiles = yield* ClaudeSessionFiles

  const admitClose = (close: ClosePane) =>
    close.confirmed
      ? Effect.void
      : createdPanes.has(close.pane).pipe(
          Effect.filterOrFail(
            (created) => created,
            () => new PaneNotCreatedByCrook({ pane: close.pane }),
          ),
        )

  const admitAnswer = (answer: AnswerAsk, row: AgentRow) =>
    row.status === 'blocked' && Option.exists(row.ask, (ask) => ask.id === answer.ask)
      ? Effect.void
      : Effect.fail(new AskNotPending({ pane: answer.pane, ask: answer.ask }))

  const admitPrompt = (row: AgentRow) =>
    Option.match(row.claudeSession, {
      onNone: () => Effect.void,
      onSome: (session) =>
        sessionFiles.waiting(session).pipe(
          Effect.filterOrFail(
            (waiting) => !Option.contains(waiting, true),
            () => claudeWaitingRefusal(),
          ),
        ),
    })

  const admitTarget = (command: PaneCommand, row: AgentRow) =>
    Match.value(command).pipe(
      Match.tagsExhaustive({
        Prompt: () => admitPrompt(row),
        SendKeys: () => Effect.void,
        RenameAgent: () => Effect.void,
        ClosePane: admitClose,
        AnswerAsk: (answer) => admitAnswer(answer, row),
      }),
    )

  const admit = Effect.fn('CommandPolicy.admit')(function* (command: PaneCommand) {
    const pane = targetPane(command)
    const row = yield* Effect.fromOption(
      Arr.findFirst((yield* sync.current).agents, (agent) => agent.pane === pane),
      () => new PaneNotAgent({ pane }),
    )

    yield* admitTarget(command, row)

    return row
  })

  return CommandPolicy.of({ admit })
})

export class CommandPolicy extends Context.Service<
  CommandPolicy,
  {
    readonly admit: (
      command: PaneCommand,
    ) => Effect.Effect<
      AgentRow,
      PaneNotAgent | PaneNotCreatedByCrook | AskNotPending | HerdrRefusedCommand
    >
  }
>()('@crook/agent/CommandPolicy') {
  static readonly layer = Layer.effect(this, make)
}
