import { describe, expect, it, layer } from '@effect/vitest'
import * as Effect from 'effect/Effect'
import * as Result from 'effect/Result'
import * as Schema from 'effect/Schema'
import * as Stream from 'effect/Stream'
import * as RpcTest from 'effect/rpc/RpcTest'

import { InputDelivered, Prompt, SendKeys } from '@crook/domain/Command'
import { HerdView } from '@crook/domain/HerdView'
import { IdempotencyKey, MachineId, PaneId } from '@crook/domain/Ids'
import { MachineState, MachineStateVersion } from '@crook/domain/MachineState'
import { AgentLink, MachineIdMismatch } from '@crook/protocol/AgentLink'
import { ClientApi } from '@crook/protocol/ClientApi'
import {
  CommandDeliveryUnknown,
  CommandId,
  CommandResult,
  MachineOffline,
  PaneNotAgent,
  RoutedCommand,
} from '@crook/protocol/Commands'

const laptop = MachineId.make('laptop')
const impostor = MachineId.make('work-vm')
const pane = PaneId.make('w1:p1')

const emptyState = (machine: MachineId) =>
  new MachineState({
    machine,
    version: MachineStateVersion.make(1),
    workspaces: [],
    tabs: [],
    agents: [],
  })

const roundTrip = <Codec extends Schema.Codec<unknown, unknown>>(
  schema: Codec,
  value: Codec['Type'],
) => {
  const line = Schema.fromJsonString(Schema.toCodecJson(schema))

  return Schema.decodeSync(line)(Schema.encodeSync(line)(value))
}

const agentLinkHandlers = AgentLink.toLayer({
  Attach: () => Stream.never,
  PublishState: ({ state }) =>
    state.machine === laptop
      ? Effect.void
      : Effect.fail(
          new MachineIdMismatch({ connectedMachine: laptop, publishedMachine: state.machine }),
        ),
  CompleteCommand: () => Effect.void,
})

const clientApiHandlers = ClientApi.toLayer({
  WatchHerd: () => Stream.make(new HerdView({ machines: [] }), new HerdView({ machines: [] })),
  SendCommand: ({ machine, command }) =>
    machine === laptop
      ? Effect.succeed(new InputDelivered({ pane: command.pane, stateChangeSeq: 0 }))
      : Effect.fail(new MachineOffline({ machine })),
})

layer(agentLinkHandlers)('AgentLink', (rpc) => {
  rpc.effect('accepts state for the connected machine', () =>
    Effect.gen(function* () {
      const client = yield* RpcTest.makeClient(AgentLink)

      yield* client.PublishState({ state: emptyState(laptop) })
    }),
  )

  rpc.effect('fails with MachineIdMismatch for another machine', () =>
    Effect.gen(function* () {
      const client = yield* RpcTest.makeClient(AgentLink)
      const mismatch = yield* client.PublishState({ state: emptyState(impostor) }).pipe(Effect.flip)

      expect(mismatch).toBeInstanceOf(MachineIdMismatch)
      expect(mismatch.message).toContain('"work-vm"')
    }),
  )
})

layer(clientApiHandlers)('ClientApi', (rpc) => {
  rpc.effect('streams every HerdView the hub emits', () =>
    Effect.gen(function* () {
      const client = yield* RpcTest.makeClient(ClientApi)
      const views = yield* client.WatchHerd().pipe(Stream.runCollect)

      expect(views).toHaveLength(2)
    }),
  )

  rpc.effect('answers SendCommand with a receipt or a tagged failure', () =>
    Effect.gen(function* () {
      const client = yield* RpcTest.makeClient(ClientApi)
      const command = new Prompt({ pane, text: 'continue' })
      const key = IdempotencyKey.make('action-1')
      const receipt = yield* client.SendCommand({ machine: laptop, key, command })
      const offline = yield* client
        .SendCommand({ machine: impostor, key, command })
        .pipe(Effect.flip)

      expect(receipt).toEqual(new InputDelivered({ pane, stateChangeSeq: 0 }))
      expect(offline).toEqual(new MachineOffline({ machine: impostor }))
    }),
  )
})

describe('Command wire shapes', () => {
  it('carries a routed command through JSON', () => {
    const routed = new RoutedCommand({
      id: CommandId.make(7),
      key: IdempotencyKey.make('action-1'),
      command: new SendKeys({ pane, keys: ['esc'] }),
    })

    expect(roundTrip(RoutedCommand, routed)).toEqual(routed)
  })

  it('carries both sides of a command result through JSON', () => {
    const delivered = Result.succeed(new InputDelivered({ pane, stateChangeSeq: 14162 }))
    const refused = Result.fail(new PaneNotAgent({ pane }))
    const unknown = Result.fail(new CommandDeliveryUnknown())

    expect(roundTrip(CommandResult, delivered)).toEqual(delivered)
    expect(roundTrip(CommandResult, refused)).toEqual(refused)
    expect(roundTrip(CommandResult, unknown)).toEqual(unknown)
  })
})
