import * as Arr from 'effect/Array'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'

import { CreatedPanes } from '@crook/agent/CreatedPanes'
import { MachineStateSync } from '@crook/agent/MachineStateSync'
import type { AgentRow } from '@crook/domain/AgentRow'
import { type ClosePane, type PaneCommand, targetPane } from '@crook/domain/Command'
import { PaneNotAgent, PaneNotCreatedByCrook } from '@crook/protocol/Commands'

const make = Effect.gen(function* () {
  const sync = yield* MachineStateSync
  const createdPanes = yield* CreatedPanes

  const admitClose = (close: ClosePane) =>
    close.confirmed
      ? Effect.void
      : createdPanes.has(close.pane).pipe(
          Effect.filterOrFail(
            (created) => created,
            () => new PaneNotCreatedByCrook({ pane: close.pane }),
          ),
        )

  const admitTarget = (command: PaneCommand) =>
    Match.value(command).pipe(
      Match.tagsExhaustive({
        Prompt: () => Effect.void,
        SendKeys: () => Effect.void,
        RenameAgent: () => Effect.void,
        ClosePane: admitClose,
      }),
    )

  const admit = Effect.fn('CommandPolicy.admit')(function* (command: PaneCommand) {
    const pane = targetPane(command)
    const row = yield* Effect.fromOption(
      Arr.findFirst((yield* sync.current).agents, (agent) => agent.pane === pane),
      () => new PaneNotAgent({ pane }),
    )

    yield* admitTarget(command)

    return row
  })

  return CommandPolicy.of({ admit })
})

export class CommandPolicy extends Context.Service<
  CommandPolicy,
  {
    readonly admit: (
      command: PaneCommand,
    ) => Effect.Effect<AgentRow, PaneNotAgent | PaneNotCreatedByCrook>
  }
>()('@crook/agent/CommandPolicy') {
  static readonly layer = Layer.effect(this, make)
}
