import * as Duration from 'effect/Duration'
import * as Rpc from 'effect/rpc/Rpc'
import * as RpcGroup from 'effect/rpc/RpcGroup'
import * as Schema from 'effect/Schema'

import { MachineId } from '@crook/domain/Ids'
import { MachineState } from '@crook/domain/MachineState'
import { CommandId, CommandResult, RoutedCommand } from '@crook/protocol/Commands'

export const AGENT_PING_INTERVAL = Duration.seconds(5)

export class MachineIdMismatch extends Schema.TaggedError<MachineIdMismatch>()(
  'MachineIdMismatch',
  {
    connectedMachine: MachineId,
    publishedMachine: MachineId,
  },
) {
  override get message(): string {
    return `This connection is authenticated as machine "${this.connectedMachine}" but published state for "${this.publishedMachine}". Check the agent's exe.dev token: the hub takes the machine id from the token, never from the payload.`
  }
}

export const Attach = Rpc.make('Attach', { success: RoutedCommand, stream: true })

export const PublishState = Rpc.make('PublishState', {
  payload: { state: MachineState },
  error: MachineIdMismatch,
})

export const CompleteCommand = Rpc.make('CompleteCommand', {
  payload: { id: CommandId, result: CommandResult },
})

export class AgentLink extends RpcGroup.make(Attach, PublishState, CompleteCommand) {}
