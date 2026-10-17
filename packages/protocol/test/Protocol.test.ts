import { expect, layer } from '@effect/vitest'
import * as Effect from 'effect/Effect'
import * as Stream from 'effect/Stream'
import * as RpcTest from 'effect/rpc/RpcTest'

import { HerdView } from '@crook/domain/HerdView'
import { MachineId } from '@crook/domain/Ids'
import { MachineState, MachineStateVersion } from '@crook/domain/MachineState'
import { AgentLink, MachineIdMismatch } from '@crook/protocol/AgentLink'
import { ClientApi } from '@crook/protocol/ClientApi'

const laptop = MachineId.make('laptop')
const impostor = MachineId.make('work-vm')

const emptyState = (machine: MachineId) =>
  new MachineState({
    machine,
    version: MachineStateVersion.make(1),
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

const clientApiHandlers = ClientApi.toLayer({
  WatchHerd: () => Stream.make(new HerdView({ machines: [] }), new HerdView({ machines: [] })),
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
})
