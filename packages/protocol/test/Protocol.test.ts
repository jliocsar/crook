import { expect, layer } from '@effect/vitest'
import * as Effect from 'effect/Effect'
import * as Stream from 'effect/Stream'
import * as RpcTest from 'effect/rpc/RpcTest'

import { CrookVersion } from '@crook/domain/CrookVersion'
import { HerdView } from '@crook/domain/HerdView'
import { MachineId, PaneId } from '@crook/domain/Ids'
import { MachineState, MachineStateVersion } from '@crook/domain/MachineState'
import { AgentLink, MachineIdMismatch } from '@crook/protocol/AgentLink'
import { ClientApi, MachineNotInHerd, PaneNotInHerd } from '@crook/protocol/ClientApi'

const laptop = MachineId.make('laptop')
const impostor = MachineId.make('work-vm')

const emptyState = (machine: MachineId) =>
  new MachineState({
    machine,
    version: MachineStateVersion.make(1),
    herdrVersion: '0.9.1',
    workspaces: [],
    tabs: [],
    agents: [],
  })

const agentLinkHandlers = AgentLink.toLayer({
  Attach: () => Stream.never,
  PublishState: ({ state }) =>
    state.machine === laptop
      ? Effect.void
      : Effect.fail(
          new MachineIdMismatch({ connectedMachine: laptop, publishedMachine: state.machine }),
        ),
})

const emptyHerd = new HerdView({ machines: [], hubVersion: CrookVersion.make('0.0.1') })

const clientApiHandlers = ClientApi.toLayer({
  WatchHerd: () => Stream.make(emptyHerd, emptyHerd),
  ForgetMachine: ({ machine }) => Effect.fail(new MachineNotInHerd({ machine })),
  MarkSeen: ({ machine, pane }) => Effect.fail(new PaneNotInHerd({ machine, pane })),
})

layer(agentLinkHandlers)('AgentLink', (it) => {
  it.effect('accepts state for the connected machine', () =>
    Effect.gen(function* () {
      const client = yield* RpcTest.makeClient(AgentLink)

      yield* client.PublishState({ state: emptyState(laptop) })
    }),
  )

  it.effect('fails with MachineIdMismatch for another machine', () =>
    Effect.gen(function* () {
      const client = yield* RpcTest.makeClient(AgentLink)
      const mismatch = yield* client.PublishState({ state: emptyState(impostor) }).pipe(Effect.flip)

      expect(mismatch).toBeInstanceOf(MachineIdMismatch)
      expect(mismatch.message).toContain('"work-vm"')
    }),
  )
})

layer(clientApiHandlers)('ClientApi', (it) => {
  it.effect('streams every HerdView the hub emits', () =>
    Effect.gen(function* () {
      const client = yield* RpcTest.makeClient(ClientApi)
      const views = yield* client.WatchHerd().pipe(Stream.runCollect)

      expect(views).toHaveLength(2)
    }),
  )

  it.effect('carries the reason a forget or a mark-seen was refused', () =>
    Effect.gen(function* () {
      const client = yield* RpcTest.makeClient(ClientApi)
      const pane = PaneId.make('w1:p1')
      const forgetFailure = yield* client.ForgetMachine({ machine: laptop }).pipe(Effect.flip)
      const markFailure = yield* client.MarkSeen({ machine: laptop, pane }).pipe(Effect.flip)

      expect(forgetFailure).toEqual(new MachineNotInHerd({ machine: laptop }))
      expect(markFailure).toEqual(new PaneNotInHerd({ machine: laptop, pane }))
    }),
  )
})
