import * as Arr from 'effect/Array'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'

import { MachineStateSync } from '@crook/agent/MachineStateSync'
import type { AgentRow } from '@crook/domain/AgentRow'
import type { Command } from '@crook/domain/Command'
import type { PaneId } from '@crook/domain/Ids'
import type { MachineState } from '@crook/domain/MachineState'
import { PaneNotAgent } from '@crook/protocol/Commands'

export const agentHosting = (state: MachineState, pane: PaneId) =>
  Arr.findFirst(state.agents, (row) => row.pane === pane)

const targetPane = (command: Command) =>
  Match.value(command).pipe(
    Match.tagsExhaustive({
      Prompt: (prompt) => prompt.pane,
      SendKeys: (sendKeys) => sendKeys.pane,
    }),
  )

const make = Effect.gen(function* () {
  const sync = yield* MachineStateSync

  const admit = Effect.fn('CommandPolicy.admit')(function* (command: Command) {
    const pane = targetPane(command)

    return yield* Effect.fromOption(
      agentHosting(yield* sync.current, pane),
      () => new PaneNotAgent({ pane }),
    )
  })

  return CommandPolicy.of({ admit })
})

export class CommandPolicy extends Context.Service<
  CommandPolicy,
  {
    readonly admit: (command: Command) => Effect.Effect<AgentRow, PaneNotAgent>
  }
>()('@crook/agent/CommandPolicy') {
  static readonly layer = Layer.effect(this, make)
}
